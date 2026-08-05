'use strict';

/**
 * Covers the failover-specific mechanism added to emailSequence.js: the
 * atomic per-lead claim that makes it safe for two independent schedulers
 * (Railway's internal cron and the GitHub-Actions fallback runner) to call
 * runOnce() at the same moment without ever both sending the same lead's
 * next stage.
 *
 * The fake repository below hand-implements the exact same compare-and-swap
 * semantics as leadsRepository.claimLeadForStage's real Supabase query
 * (UPDATE ... WHERE email_stage = expected AND not claimed/expired ...
 * RETURNING) against a plain in-memory object, with a real async gap
 * (setImmediate) inside the claim so two "simultaneous" callers genuinely
 * interleave instead of just running sequentially -- this is what lets the
 * test prove the ALGORITHM (only one of two racing claims can ever win),
 * not just that the code compiles.
 *
 * Each "worker" gets its own isolated instance of emailSequence.js (via
 * jest.isolateModules) so the module's in-process mutex -- which only
 * protects one process, and would otherwise silently make this test pass
 * for the wrong reason -- can't mask a broken cross-process claim.
 */

// SENDER_POOL is read at module-load time (emailSequence.js's top-level
// `const SENDER_POOL = parseSenderPool()`), so it needs to be set before any
// isolated instance of the module is first required below.
process.env.EMAIL_SENDER_POOL = 'x@stanweb.tech';
process.env.EMAIL_SENDER_NAMES = 'X';

const CLAIM_TIMEOUT_MS = 10 * 60000;

function makeFakeRepo(store) {
  return {
    getEmailSequenceCandidates: jest.fn(async () => {
      const lead = store.lead;
      if (!lead || lead.email_replied || lead.email_stopped) return [];
      const stage = lead.email_stage || 0;
      if (stage >= 4) return [];
      return [{ lead: { ...lead }, nextStage: stage + 1, isNew: stage === 0 }];
    }),
    claimLeadForStage: jest.fn(async (placeId, expectedStage, workerId) => {
      await new Promise((r) => setImmediate(r)); // force a real interleaving window
      const lead = store.lead;
      if (!lead || lead.place_id !== placeId) return false;
      if ((lead.email_stage || 0) !== expectedStage) return false;
      if (lead.email_replied || lead.email_stopped) return false;
      const claimedAt = lead.email_claimed_at ? Date.parse(lead.email_claimed_at) : null;
      if (claimedAt && Date.now() - claimedAt < CLAIM_TIMEOUT_MS) return false;
      lead.email_claimed_at = new Date().toISOString();
      lead.email_claimed_by = workerId;
      return true;
    }),
    releaseClaim: jest.fn(async (placeId) => {
      if (store.lead && store.lead.place_id === placeId) {
        store.lead.email_claimed_at = null;
        store.lead.email_claimed_by = null;
      }
    }),
    recordEmailStageSent: jest.fn(async (placeId, stage) => {
      if (store.lead && store.lead.place_id === placeId) {
        store.lead.email_stage = stage;
        store.lead.email_claimed_at = null;
        store.lead.email_claimed_by = null;
      }
    }),
    setEmailFlag: jest.fn(),
    logOutreach: jest.fn(),
    countEmailSendsToday: jest.fn(async () => 0),
    getSenderNewLeadCountsToday: jest.fn(async () => ({})),
    getSenderFirstSendDates: jest.fn(async () => ({})),
    setAssignedSender: jest.fn(),
    getLastEmailSendTime: jest.fn(async () => null),
    getEmailSequenceStats: jest.fn(),
    getEmailPerformanceStats: jest.fn(),
    recordHealthSuccess: jest.fn(),
    recordHealthFailure: jest.fn(async () => 1),
  };
}

function loadIsolatedWorker(fakeRepo, sendEmailMock) {
  let worker;
  jest.isolateModules(() => {
    jest.doMock('../src/db/leadsRepository', () => fakeRepo);
    jest.doMock('../src/services/aiMessageService', () => ({
      generateEmail: jest.fn(async () => ({ subject: 's', text: 't' })),
      generateDecoyOpener: jest.fn(() => ({ subject: 's', text: 't' })),
    }));
    jest.doMock('../src/services/emailService', () => ({ sendEmail: sendEmailMock }));
    worker = require('../src/services/emailSequence');
  });
  return worker;
}

describe('emailSequence failover: atomic per-lead claim', () => {
  test('two simultaneous workers racing the same due lead: only one sends', async () => {
    const store = { lead: { place_id: 'p1', email: 'a@b.com', name: 'A Biz', email_stage: 0, email_replied: false, email_stopped: false, assigned_sender: null } };
    const fakeRepo = makeFakeRepo(store);
    const sendEmailMock = jest.fn(async () => ({ messageId: 'm1' }));

    const workerA = loadIsolatedWorker(fakeRepo, sendEmailMock);
    const workerB = loadIsolatedWorker(fakeRepo, sendEmailMock);

    const [resultA, resultB] = await Promise.all([
      workerA.runOnce({ workerId: 'railway' }),
      workerB.runOnce({ workerId: 'github-fallback' }),
    ]);

    const sent = [resultA, resultB].filter((r) => r.sent);
    expect(sent).toHaveLength(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(store.lead.email_stage).toBe(1);
    expect(fakeRepo.claimLeadForStage).toHaveBeenCalled();
  });

  test('claim held by a crashed worker blocks a reclaim until the timeout passes', async () => {
    const store = { lead: { place_id: 'p2', email_stage: 0, email_replied: false, email_stopped: false } };
    const fakeRepo = makeFakeRepo(store);

    const firstClaim = await fakeRepo.claimLeadForStage('p2', 0, 'railway');
    expect(firstClaim).toBe(true);

    // Simulated crash: the worker that won the claim never calls
    // recordEmailStageSent or releaseClaim.
    const reclaimTooSoon = await fakeRepo.claimLeadForStage('p2', 0, 'github-fallback');
    expect(reclaimTooSoon).toBe(false);

    store.lead.email_claimed_at = new Date(Date.now() - 11 * 60000).toISOString(); // past the 10min timeout
    const reclaimAfterTimeout = await fakeRepo.claimLeadForStage('p2', 0, 'github-fallback');
    expect(reclaimAfterTimeout).toBe(true);
  });

  test('a lost claim race means the loser tries the next candidate instead of no-op-ing entirely', async () => {
    // A single worker where the FIRST candidate's claim is already held by
    // someone else (simulating "the other worker got there first"), but a
    // second due candidate is free.
    const claimLeadForStage = jest
      .fn()
      .mockResolvedValueOnce(false) // lead A: lost the race
      .mockResolvedValueOnce(true); // lead B: won
    const fakeRepo = {
      getEmailSequenceCandidates: jest.fn(async () => [
        { lead: { place_id: 'a', email: 'a@x.com', email_stage: 1, assigned_sender: 'x@stanweb.tech' }, nextStage: 2, isNew: false },
        { lead: { place_id: 'b', email: 'b@x.com', email_stage: 1, assigned_sender: 'x@stanweb.tech' }, nextStage: 2, isNew: false },
      ]),
      claimLeadForStage,
      releaseClaim: jest.fn(),
      recordEmailStageSent: jest.fn(),
      setEmailFlag: jest.fn(),
      logOutreach: jest.fn(),
      countEmailSendsToday: jest.fn(async () => 0),
      getSenderNewLeadCountsToday: jest.fn(async () => ({})),
      getSenderFirstSendDates: jest.fn(async () => ({})),
      setAssignedSender: jest.fn(),
      getLastEmailSendTime: jest.fn(async () => null),
      getEmailSequenceStats: jest.fn(),
      getEmailPerformanceStats: jest.fn(),
      recordHealthSuccess: jest.fn(),
      recordHealthFailure: jest.fn(async () => 1),
    };
    const sendEmailMock = jest.fn(async () => ({ messageId: 'm1' }));
    const worker = loadIsolatedWorker(fakeRepo, sendEmailMock);

    const result = await worker.runOnce({ workerId: 'railway' });

    expect(claimLeadForStage).toHaveBeenCalledTimes(2);
    expect(result.sent).toBe(true);
    expect(result.place_id).toBe('b');
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  test('a failed send releases the claim and does not advance the stage, so the next tick can retry', async () => {
    const store = { lead: { place_id: 'p3', email: 'c@x.com', email_stage: 1, email_replied: false, email_stopped: false, assigned_sender: 'x@stanweb.tech' } };
    const fakeRepo = makeFakeRepo(store);
    const sendEmailMock = jest.fn().mockRejectedValueOnce(new Error('SES throttled')).mockResolvedValueOnce({ messageId: 'm2' });
    const worker = loadIsolatedWorker(fakeRepo, sendEmailMock);

    const failedResult = await worker.runOnce({ workerId: 'railway' });
    expect(failedResult.reason).toBe('send_failed');
    expect(store.lead.email_stage).toBe(1); // unchanged -- still due for the same stage
    expect(store.lead.email_claimed_at).toBeNull(); // released, not left locked until timeout

    const retryResult = await worker.runOnce({ workerId: 'railway' });
    expect(retryResult.sent).toBe(true);
    expect(store.lead.email_stage).toBe(2);
  });
});
