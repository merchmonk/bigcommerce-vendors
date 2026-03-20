import {
  calculateVendorHealthPercent,
  deriveVendorOperationalStatus,
} from '@lib/vendors/operatorInsights';

describe('operatorInsights', () => {
  test('returns deactivated status before any sync state', () => {
    expect(
      deriveVendorOperationalStatus({
        is_active: false,
        hasActiveJob: true,
        latestSyncRunStatus: 'FAILED',
        latestJobTerminalStatus: 'FAILED',
      }),
    ).toBe('DEACTIVATED');
  });

  test('returns syncing when an active job is present', () => {
    expect(
      deriveVendorOperationalStatus({
        is_active: true,
        hasActiveJob: true,
        latestSyncRunStatus: 'SUCCESS',
        latestJobTerminalStatus: 'SUCCEEDED',
      }),
    ).toBe('SYNCING');
  });

  test('returns sync failed when the latest terminal state failed', () => {
    expect(
      deriveVendorOperationalStatus({
        is_active: true,
        hasActiveJob: false,
        latestSyncRunStatus: 'SUCCESS',
        latestJobTerminalStatus: 'FAILED',
      }),
    ).toBe('SYNC_FAILED');
  });

  test('returns synced when there is no active job and no recent failure', () => {
    expect(
      deriveVendorOperationalStatus({
        is_active: true,
        hasActiveJob: false,
        latestSyncRunStatus: 'SUCCESS',
        latestJobTerminalStatus: 'SUCCEEDED',
      }),
    ).toBe('SYNCED');
  });

  test('calculates health percent from completed syncs only', () => {
    expect(calculateVendorHealthPercent({ successfulSyncs: 8, failedSyncs: 2 })).toBe(80);
    expect(calculateVendorHealthPercent({ successfulSyncs: 0, failedSyncs: 0 })).toBeNull();
  });
});
