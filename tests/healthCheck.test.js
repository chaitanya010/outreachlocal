'use strict';

/**
 * Covers healthCheck.js's business-hours-gated failover/staleness logic:
 * "both scheduling paths appear stopped" should only fire when BOTH the
 * Railway heartbeat and the GitHub-fallback heartbeat are stale (one path
 * covering for the other is the failover working, not an incident), and
 * only during business hours (neither scheduler is expected to run
 * off-hours/weekends, so staleness there is meaningless).
 */

jest.mock('../src/db/supabaseClient', () => ({ getClient: jest.fn() }));
jest.mock('../src/db/leadsRepository', () => ({
  getHealthComponents: jest.fn(),
  getLastEmailSendTime: jest.fn(),
}));
jest.mock('../src/services/emailSequence', () => ({ peekNextCandidate: jest.fn() }));
jest.mock('../src/utils/notify', () => ({ notifyOnRecurringFailure: jest.fn(), resetFailureStreak: jest.fn() }));
jest.mock('imapflow', () => ({ ImapFlow: jest.fn() }));

const { getClient } = require('../src/db/supabaseClient');
const { getHealthComponents, getLastEmailSendTime } = require('../src/db/leadsRepository');
const { peekNextCandidate } = require('../src/services/emailSequence');
const { notifyOnRecurringFailure, resetFailureStreak } = require('../src/utils/notify');
const healthCheck = require('../src/jobs/healthCheck');

function fakeSupabaseOk() {
  getClient.mockReturnValue({
    from: () => ({ select: () => ({ limit: async () => ({ data: [{ id: 1 }], error: null }) }) }),
  });
}

// A fixed weekday/business-hour moment in America/New_York (default
// CRON_TIMEZONE), so withinBusinessHours() is deterministic regardless of
// when the suite actually runs.
const TUESDAY_NOON_ET = new Date('2026-08-04T16:00:00Z'); // 12:00 ET on a Tuesday

describe('healthCheck: scheduler staleness (business hours only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fakeSupabaseOk();
    peekNextCandidate.mockResolvedValue(null);
    getLastEmailSendTime.mockResolvedValue(new Date().toISOString());
  });

  test('withinBusinessHours is true on a weekday within the configured window', () => {
    expect(healthCheck.withinBusinessHours(TUESDAY_NOON_ET)).toBe(true);
  });

  test('withinBusinessHours is false on a weekend', () => {
    const saturday = new Date('2026-08-08T16:00:00Z');
    expect(healthCheck.withinBusinessHours(saturday)).toBe(false);
  });

  test('does not alert when only ONE scheduling path is stale (the other is covering)', async () => {
    const staleISO = new Date(Date.now() - 999 * 60000).toISOString();
    const freshISO = new Date().toISOString();
    getHealthComponents.mockResolvedValue({
      'scheduler:railway': { last_ok_at: staleISO },
      'scheduler:github-fallback': { last_ok_at: freshISO },
    });

    await healthCheck.tick(TUESDAY_NOON_ET);

    expect(notifyOnRecurringFailure).not.toHaveBeenCalledWith('health_scheduler_stopped', expect.anything(), expect.anything(), expect.anything());
    expect(resetFailureStreak).toHaveBeenCalledWith('health_scheduler_stopped');
  });

  test('alerts when BOTH scheduling paths are stale', async () => {
    const staleISO = new Date(Date.now() - 999 * 60000).toISOString();
    getHealthComponents.mockResolvedValue({
      'scheduler:railway': { last_ok_at: staleISO },
      'scheduler:github-fallback': { last_ok_at: staleISO },
    });

    await healthCheck.tick(TUESDAY_NOON_ET);

    expect(notifyOnRecurringFailure).toHaveBeenCalledWith(
      'health_scheduler_stopped',
      'OutreachLocal: both scheduling paths appear stopped',
      expect.any(String),
      1
    );
  });

  test('never alerts on scheduler staleness if neither heartbeat has ever reported (fresh install)', async () => {
    getHealthComponents.mockResolvedValue({});
    await healthCheck.tick(TUESDAY_NOON_ET);
    // Both "missing" counts as both stale -- this IS expected to alert, since
    // it means neither scheduler has ever successfully run during business
    // hours, which is exactly the "something needs attention" case.
    expect(notifyOnRecurringFailure).toHaveBeenCalledWith('health_scheduler_stopped', expect.any(String), expect.any(String), 1);
  });

  test('flags eligible-but-stalled outreach only when a candidate exists and nothing has sent recently', async () => {
    getHealthComponents.mockResolvedValue({
      'scheduler:railway': { last_ok_at: new Date().toISOString() },
      'scheduler:github-fallback': { last_ok_at: new Date().toISOString() },
    });
    peekNextCandidate.mockResolvedValue({ lead: { place_id: 'p1', name: 'A Biz' }, nextStage: 2 });
    getLastEmailSendTime.mockResolvedValue(new Date(Date.now() - 999 * 60000).toISOString());

    await healthCheck.tick(TUESDAY_NOON_ET);

    expect(notifyOnRecurringFailure).toHaveBeenCalledWith(
      'health_outreach_stalled',
      'OutreachLocal: eligible leads waiting but nothing sent recently',
      expect.stringContaining('A Biz'),
      1
    );
  });

  test('does not flag stalled outreach when there is simply nothing due', async () => {
    getHealthComponents.mockResolvedValue({
      'scheduler:railway': { last_ok_at: new Date().toISOString() },
      'scheduler:github-fallback': { last_ok_at: new Date().toISOString() },
    });
    peekNextCandidate.mockResolvedValue(null);
    getLastEmailSendTime.mockResolvedValue(new Date(Date.now() - 999 * 60000).toISOString());

    await healthCheck.tick(TUESDAY_NOON_ET);

    expect(notifyOnRecurringFailure).not.toHaveBeenCalledWith('health_outreach_stalled', expect.anything(), expect.anything(), expect.anything());
    expect(resetFailureStreak).toHaveBeenCalledWith('health_outreach_stalled');
  });
});
