'use strict';

/**
 * notifyOnRecurringFailure/resetFailureStreak used to keep their
 * consecutive-failure counters in an in-memory Map -- reset on every process
 * restart (and meaningless for the GitHub-Actions fallback runner, which is
 * a brand-new process on every invocation). They're now persisted in
 * Supabase via leadsRepository's recordHealthFailure/recordHealthSuccess, so
 * this covers that the throttling behavior (first failure alerts, then only
 * every Nth) is driven by the persisted count, not a local counter.
 */

jest.mock('../src/services/emailService', () => ({ sendEmail: jest.fn() }));
jest.mock('../src/db/leadsRepository', () => ({
  recordHealthFailure: jest.fn(),
  recordHealthSuccess: jest.fn(),
}));

const { sendEmail } = require('../src/services/emailService');
const { recordHealthFailure, recordHealthSuccess } = require('../src/db/leadsRepository');
const { notifyOnRecurringFailure, resetFailureStreak } = require('../src/utils/notify');

describe('notifyOnRecurringFailure / resetFailureStreak (DB-backed)', () => {
  const originalNotifyEmail = process.env.NOTIFY_EMAIL;

  beforeEach(() => {
    process.env.NOTIFY_EMAIL = 'owner@stanweb.tech';
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env.NOTIFY_EMAIL = originalNotifyEmail;
  });

  test('alerts on the first failure using the persisted count, not a local counter', async () => {
    recordHealthFailure.mockResolvedValue(1); // e.g. a fresh process, but this is failure #1 in the DB
    sendEmail.mockResolvedValue({ messageId: 'm1' });

    await notifyOnRecurringFailure('email_send', 'subject', 'body');

    expect(recordHealthFailure).toHaveBeenCalledWith('failure:email_send', 'body');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('does not alert on failures 2-4 (between the first and the Nth)', async () => {
    for (const count of [2, 3, 4]) {
      recordHealthFailure.mockResolvedValue(count);
      await notifyOnRecurringFailure('email_send', 'subject', 'body', 5);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('alerts again on the 5th consecutive failure', async () => {
    recordHealthFailure.mockResolvedValue(5);
    await notifyOnRecurringFailure('email_send', 'subject', 'body', 5);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test('resetFailureStreak clears the persisted streak via recordHealthSuccess', async () => {
    await resetFailureStreak('email_send');
    expect(recordHealthSuccess).toHaveBeenCalledWith('failure:email_send');
  });

  test('degrades gracefully (still alerts, does not throw) if persisting the streak itself fails', async () => {
    // e.g. Supabase is down -- exactly the scenario a caller is often
    // already mid-error-handling for, so this must not compound into an
    // unhandled rejection that crashes the caller.
    recordHealthFailure.mockRejectedValue(new Error('Supabase unreachable'));
    sendEmail.mockResolvedValue({ messageId: 'm1' });

    await expect(notifyOnRecurringFailure('email_send', 'subject', 'body')).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1); // falls back to alerting rather than staying silent
  });

  test('a failure streak survives what would be a process restart -- the count is read from Supabase, not memory', async () => {
    // Simulates: process A recorded failures 1-4, then the process restarted
    // (Railway redeploy). A fresh notify.js module has no memory of that,
    // but the DB does -- the very next failure should already be #5 and
    // alert, not reset back to #1.
    recordHealthFailure.mockResolvedValue(5);
    await notifyOnRecurringFailure('email_cron_tick', 'subject', 'body', 5);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
