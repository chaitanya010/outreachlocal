'use strict';

/**
 * Unit-tests the actual Supabase query leadsRepository.claimLeadForStage
 * builds (as opposed to tests/emailSequenceFailover.test.js, which tests the
 * application-level claim/release wiring against a hand-rolled in-memory
 * fake). Postgres itself is what guarantees a single `UPDATE ... WHERE ...`
 * is atomic across concurrent callers -- that's not something a unit test
 * can exercise without a real database -- so what's verified here is that
 * the WHERE conditions sent are the correct ones: matches the expected
 * stage, excludes replied/stopped leads, and only claims when unclaimed or
 * past the timeout.
 */

jest.mock('../src/db/supabaseClient', () => ({ getClient: jest.fn() }));

const { getClient } = require('../src/db/supabaseClient');
const { claimLeadForStage, releaseClaim, recordEmailStageSent } = require('../src/db/leadsRepository');

function makeChainableUpdateMock(resolvedValue) {
  const calls = { eq: [], or: [] };
  const builder = {
    eq: jest.fn((...args) => {
      calls.eq.push(args);
      return builder;
    }),
    or: jest.fn((...args) => {
      calls.or.push(args);
      return builder;
    }),
    select: jest.fn(async () => resolvedValue),
  };
  const update = jest.fn(() => builder);
  const from = jest.fn(() => ({ update }));
  getClient.mockReturnValue({ from });
  return { from, update, calls };
}

describe('claimLeadForStage', () => {
  test('claims when the row matches expected stage and is unclaimed (1 row affected -> true)', async () => {
    const { from, update, calls } = makeChainableUpdateMock({ data: [{ id: 'row1' }], error: null });

    const won = await claimLeadForStage('place1', 2, 'railway', 10);

    expect(won).toBe(true);
    expect(from).toHaveBeenCalledWith('leads');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ email_claimed_by: 'railway' }));
    expect(calls.eq).toContainEqual(['place_id', 'place1']);
    expect(calls.eq).toContainEqual(['email_stage', 2]);
    expect(calls.eq).toContainEqual(['email_replied', false]);
    expect(calls.eq).toContainEqual(['email_stopped', false]);
    expect(calls.or).toHaveLength(1);
    expect(calls.or[0][0]).toMatch(/^email_claimed_at\.is\.null,email_claimed_at\.lt\./);
  });

  test('loses the race when zero rows match (already claimed/stage moved) -> false', async () => {
    makeChainableUpdateMock({ data: [], error: null });
    const won = await claimLeadForStage('place1', 2, 'railway', 10);
    expect(won).toBe(false);
  });

  test('throws on a genuine Supabase error rather than silently reporting a lost claim', async () => {
    makeChainableUpdateMock({ data: null, error: new Error('connection reset') });
    await expect(claimLeadForStage('place1', 2, 'railway', 10)).rejects.toThrow('connection reset');
  });
});

describe('releaseClaim', () => {
  test('clears both claim columns and never throws even on a DB error', async () => {
    const calls = { eq: [] };
    const builder = {
      eq: jest.fn((...args) => {
        calls.eq.push(args);
        return Promise.resolve({ error: new Error('boom') });
      }),
    };
    const update = jest.fn(() => builder);
    getClient.mockReturnValue({ from: jest.fn(() => ({ update })) });

    await expect(releaseClaim('place1')).resolves.toBeUndefined(); // swallows the error
    expect(update).toHaveBeenCalledWith({ email_claimed_at: null, email_claimed_by: null });
  });
});

describe('recordEmailStageSent', () => {
  test('also clears the claim as part of the same write', async () => {
    const eqMock = jest.fn(() => Promise.resolve({ error: null }));
    const update = jest.fn(() => ({ eq: eqMock }));
    getClient.mockReturnValue({ from: jest.fn(() => ({ update })) });

    await recordEmailStageSent('place1', 2);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ email_stage: 2, email_claimed_at: null, email_claimed_by: null })
    );
  });
});
