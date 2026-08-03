'use strict';

/**
 * Covers run-fallback-outreach.js -- the entrypoint the GitHub-Actions
 * fallback workflow runs directly (no Railway involved). Verifies it calls
 * the same emailSequence.runOnce() core with workerId 'github-fallback', and
 * that it fails soft (a heads-up notification + non-zero exit code) rather
 * than throwing -- a crashed fallback run must never look like a hung CI job
 * with no explanation.
 *
 * Each test gets its own isolated module registry (jest.isolateModules) so
 * the script -- which runs its main() as a top-level side effect on require,
 * like the repo's other root-level entrypoints (generate-leads.js etc.) --
 * can be exercised fresh with different mock behavior per test, instead of
 * hitting Node's require cache on the second require.
 */

function loadWithMocks({ runOnceImpl }) {
  const mocks = {
    runOnce: jest.fn(runOnceImpl),
    recordHealthSuccess: jest.fn(),
    notifyOnRecurringFailure: jest.fn(),
    resetFailureStreak: jest.fn(),
  };
  jest.isolateModules(() => {
    jest.doMock('../src/services/emailSequence', () => ({ runOnce: mocks.runOnce }));
    jest.doMock('../src/db/leadsRepository', () => ({ recordHealthSuccess: mocks.recordHealthSuccess }));
    jest.doMock('../src/utils/notify', () => ({
      notifyOnRecurringFailure: mocks.notifyOnRecurringFailure,
      resetFailureStreak: mocks.resetFailureStreak,
    }));
    require('../run-fallback-outreach.js');
  });
  return mocks;
}

describe('run-fallback-outreach.js', () => {
  const originalExitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  test('runs the shared sequence engine as the github-fallback worker and records a heartbeat on success', async () => {
    const mocks = loadWithMocks({ runOnceImpl: async () => ({ sent: false, reason: 'no_candidates' }) });
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget main() promise chain settle

    expect(mocks.runOnce).toHaveBeenCalledWith({ workerId: 'github-fallback' });
    expect(mocks.recordHealthSuccess).toHaveBeenCalledWith('scheduler:github-fallback');
    expect(mocks.resetFailureStreak).toHaveBeenCalledWith('fallback_run');
    expect(mocks.notifyOnRecurringFailure).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  test('a crashed run notifies and exits non-zero instead of throwing', async () => {
    const mocks = loadWithMocks({
      runOnceImpl: async () => {
        throw new Error('Supabase unreachable');
      },
    });
    await new Promise((r) => setImmediate(r));

    expect(mocks.notifyOnRecurringFailure).toHaveBeenCalledWith(
      'fallback_run',
      'OutreachLocal: fallback scheduler run crashed',
      'Supabase unreachable'
    );
    expect(process.exitCode).toBe(1);
  });
});
