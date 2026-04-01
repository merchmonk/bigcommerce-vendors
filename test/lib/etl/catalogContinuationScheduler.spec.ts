import { enqueuePendingCatalogContinuationJobs } from '@lib/etl/catalogContinuationScheduler';

const mockFindLatestActiveCatalogSyncJobForVendor = jest.fn();
const mockGetSyncRunById = jest.fn();
const mockListSyncRunsPendingCatalogContinuation = jest.fn();
const mockSubmitCatalogSyncJob = jest.fn();
const mockUpdateSyncRunProgress = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  findLatestActiveCatalogSyncJobForVendor: (...args: unknown[]) => mockFindLatestActiveCatalogSyncJobForVendor(...args),
  getSyncRunById: (...args: unknown[]) => mockGetSyncRunById(...args),
  listSyncRunsPendingCatalogContinuation: (...args: unknown[]) => mockListSyncRunsPendingCatalogContinuation(...args),
  updateSyncRunProgress: (...args: unknown[]) => mockUpdateSyncRunProgress(...args),
}));

jest.mock('@lib/integrationJobs', () => ({
  submitCatalogSyncJob: (...args: unknown[]) => mockSubmitCatalogSyncJob(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('enqueuePendingCatalogContinuationJobs', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetSyncRunById.mockImplementation(async (syncRunId: number) => ({
      etl_sync_run_id: syncRunId,
      vendor_id: 10,
      endpoint_mapping_id: null,
      sync_scope: 'ALL',
      details: {
        continuation: {
          enqueued: false,
          next_start_reference_index: 15,
          total_references: 242,
          max_references_per_run: 15,
          initial_last_successful_sync_at: null,
          source_action: 'manual_sync',
          correlation_id: 'corr-sync',
        },
      },
    }));
    mockUpdateSyncRunProgress.mockResolvedValue({});
  });

  test('queues a pending continuation job and marks the sync run as enqueued', async () => {
    mockListSyncRunsPendingCatalogContinuation.mockResolvedValue([
      {
        etl_sync_run_id: 141,
        vendor_id: 10,
        endpoint_mapping_id: null,
        sync_scope: 'ALL',
        details: {
          continuation: {
            enqueued: false,
            next_start_reference_index: 15,
            total_references: 242,
            max_references_per_run: 15,
            initial_last_successful_sync_at: null,
            source_action: 'manual_sync',
            correlation_id: 'corr-sync',
          },
        },
      },
    ]);
    mockFindLatestActiveCatalogSyncJobForVendor.mockResolvedValue(null);
    mockSubmitCatalogSyncJob.mockResolvedValue({
      job: {
        integration_job_id: 901,
      },
      deduplicated: false,
    });

    const result = await enqueuePendingCatalogContinuationJobs({
      limit: 25,
    });

    expect(mockListSyncRunsPendingCatalogContinuation).toHaveBeenCalledWith(25);
    expect(mockSubmitCatalogSyncJob).toHaveBeenCalledWith({
      vendorId: 10,
      mappingId: undefined,
      syncAll: true,
      sourceAction: 'manual_sync',
      correlationId: 'corr-sync',
      requestPayload: {
        continuation: {
          start_reference_index: 15,
          max_references_per_run: 15,
          initial_last_successful_sync_at: null,
        },
        source_sync_run_id: 141,
      },
    });
    expect(mockUpdateSyncRunProgress).toHaveBeenCalledWith({
      etl_sync_run_id: 141,
      details: expect.objectContaining({
        continuation: expect.objectContaining({
          enqueued: true,
          integration_job_id: 901,
          deduplicated: false,
        }),
      }),
    });
    expect(result).toEqual({
      queued: 1,
      deduplicated: 0,
      skipped: 0,
      scanned: 1,
    });
  });

  test('marks the sync run when the matching continuation job is already active', async () => {
    mockListSyncRunsPendingCatalogContinuation.mockResolvedValue([
      {
        etl_sync_run_id: 142,
        vendor_id: 10,
        endpoint_mapping_id: null,
        sync_scope: 'ALL',
        details: {
          continuation: {
            enqueued: false,
            next_start_reference_index: 30,
            total_references: 242,
            max_references_per_run: 15,
            initial_last_successful_sync_at: null,
            source_action: 'manual_sync',
            correlation_id: 'corr-sync',
          },
        },
      },
    ]);
    mockFindLatestActiveCatalogSyncJobForVendor.mockResolvedValue({
      integration_job_id: 902,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 10,
      endpoint_mapping_id: null,
      sync_scope: 'ALL',
      source_action: 'manual_sync',
      request_payload: {
        continuation: {
          start_reference_index: 30,
        },
      },
    });

    const result = await enqueuePendingCatalogContinuationJobs();

    expect(mockSubmitCatalogSyncJob).not.toHaveBeenCalled();
    expect(mockUpdateSyncRunProgress).toHaveBeenCalledWith({
      etl_sync_run_id: 142,
      details: expect.objectContaining({
        continuation: expect.objectContaining({
          enqueued: true,
          integration_job_id: 902,
          deduplicated: true,
        }),
      }),
    });
    expect(result).toEqual({
      queued: 0,
      deduplicated: 1,
      skipped: 0,
      scanned: 1,
    });
  });

  test('defers pending continuations while another catalog sync job is active for the vendor', async () => {
    mockListSyncRunsPendingCatalogContinuation.mockResolvedValue([
      {
        etl_sync_run_id: 143,
        vendor_id: 10,
        endpoint_mapping_id: null,
        sync_scope: 'ALL',
        details: {
          continuation: {
            enqueued: false,
            next_start_reference_index: 45,
            total_references: 242,
            max_references_per_run: 15,
            initial_last_successful_sync_at: null,
            source_action: 'manual_sync',
            correlation_id: 'corr-sync',
          },
        },
      },
    ]);
    mockFindLatestActiveCatalogSyncJobForVendor.mockResolvedValue({
      integration_job_id: 903,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 10,
      endpoint_mapping_id: null,
      sync_scope: 'ALL',
      source_action: 'manual_sync',
      request_payload: {},
    });

    const result = await enqueuePendingCatalogContinuationJobs();

    expect(mockSubmitCatalogSyncJob).not.toHaveBeenCalled();
    expect(mockUpdateSyncRunProgress).not.toHaveBeenCalled();
    expect(result).toEqual({
      queued: 0,
      deduplicated: 0,
      skipped: 1,
      scanned: 1,
    });
  });
});
