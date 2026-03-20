export {};

const mockCreateIntegrationJob = jest.fn();
const mockCreateIntegrationJobEvent = jest.fn();
const mockFindActiveIntegrationJobByDedupeKey = jest.fn();
const mockFinalizeIntegrationJob = jest.fn();
const mockGetIntegrationJobById = jest.fn();
const mockListIntegrationJobEvents = jest.fn();
const mockMarkIntegrationJobEnqueued = jest.fn();
const mockSqsSend = jest.fn();
const mockPublishPlatformEvent = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  createIntegrationJob: (...args: unknown[]) => mockCreateIntegrationJob(...args),
  createIntegrationJobEvent: (...args: unknown[]) => mockCreateIntegrationJobEvent(...args),
  finalizeIntegrationJob: (...args: unknown[]) => mockFinalizeIntegrationJob(...args),
  findActiveIntegrationJobByDedupeKey: (...args: unknown[]) => mockFindActiveIntegrationJobByDedupeKey(...args),
  getIntegrationJobById: (...args: unknown[]) => mockGetIntegrationJobById(...args),
  listIntegrationJobEvents: (...args: unknown[]) => mockListIntegrationJobEvents(...args),
  markIntegrationJobEnqueued: (...args: unknown[]) => mockMarkIntegrationJobEnqueued(...args),
}));

jest.mock('@lib/awsClients', () => ({
  getSqsClient: () => ({
    send: (...args: unknown[]) => mockSqsSend(...args),
  }),
}));

jest.mock('@lib/platformEvents', () => ({
  publishPlatformEvent: (...args: unknown[]) => mockPublishPlatformEvent(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('integration job dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTEGRATION_JOB_QUEUE_URL = 'https://queue.example.com/jobs';
  });

  test('reuses an active integration job instead of creating a duplicate', async () => {
    const existingJob = {
      integration_job_id: 44,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 7,
      mapping_id: null,
      sync_scope: 'ALL',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:7:ALL:all:manual_sync',
      correlation_id: 'corr-1',
      request_payload: {},
      status: 'ENQUEUED',
      attempt_count: 0,
      queue_message_id: 'message-1',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    };
    mockFindActiveIntegrationJobByDedupeKey.mockResolvedValue(existingJob);

    const { submitCatalogSyncJob } = await import('@lib/integrationJobs');
    const result = await submitCatalogSyncJob({
      vendorId: 7,
      syncAll: true,
      sourceAction: 'manual_sync',
      correlationId: 'corr-1',
    });

    expect(result).toEqual({
      job: existingJob,
      deduplicated: true,
    });
    expect(mockCreateIntegrationJob).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 44,
        event_name: 'job_reused',
      }),
    );
  });

  test('creates, enqueues, and publishes a new integration job when no active match exists', async () => {
    mockFindActiveIntegrationJobByDedupeKey.mockResolvedValue(null);
    mockCreateIntegrationJob.mockResolvedValue({
      integration_job_id: 81,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 9,
      mapping_id: 22,
      sync_scope: 'MAPPING',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:9:MAPPING:22:manual_sync',
      correlation_id: 'corr-9',
      request_payload: { mapping_id: 22 },
      status: 'PENDING',
      attempt_count: 0,
      queue_message_id: null,
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });
    mockSqsSend.mockResolvedValue({ MessageId: 'message-81' });
    mockMarkIntegrationJobEnqueued.mockResolvedValue({
      integration_job_id: 81,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 9,
      mapping_id: 22,
      sync_scope: 'MAPPING',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:9:MAPPING:22:manual_sync',
      correlation_id: 'corr-9',
      request_payload: { mapping_id: 22 },
      status: 'ENQUEUED',
      attempt_count: 0,
      queue_message_id: 'message-81',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });

    const { submitCatalogSyncJob } = await import('@lib/integrationJobs');
    const result = await submitCatalogSyncJob({
      vendorId: 9,
      mappingId: 22,
      sourceAction: 'manual_sync',
      correlationId: 'corr-9',
      requestPayload: { mapping_id: 22 },
    });

    expect(mockCreateIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_id: 9,
        mapping_id: 22,
        sync_scope: 'MAPPING',
        source_action: 'manual_sync',
      }),
    );
    expect(mockSqsSend).toHaveBeenCalledTimes(1);
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 81,
        event_name: 'job_submitted',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 81,
        event_name: 'job_enqueued',
      }),
    );
    expect(mockPublishPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detailType: 'product.sync.submitted',
      }),
    );
    expect(result.deduplicated).toBe(false);
    expect(result.job.status).toBe('ENQUEUED');
  });

  test('finalizes the job as failed when queue submission throws', async () => {
    mockFindActiveIntegrationJobByDedupeKey.mockResolvedValue(null);
    mockCreateIntegrationJob.mockResolvedValue({
      integration_job_id: 91,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 11,
      mapping_id: null,
      sync_scope: 'ALL',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:11:ALL:all:manual_sync',
      correlation_id: 'corr-11',
      request_payload: {},
      status: 'PENDING',
      attempt_count: 0,
      queue_message_id: null,
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });
    mockSqsSend.mockRejectedValue(new Error('queue offline'));

    const { submitCatalogSyncJob } = await import('@lib/integrationJobs');

    await expect(
      submitCatalogSyncJob({
        vendorId: 11,
        syncAll: true,
        sourceAction: 'manual_sync',
        correlationId: 'corr-11',
      }),
    ).rejects.toThrow('queue offline');

    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 91,
        status: 'FAILED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 91,
        event_name: 'job_enqueue_failed',
        level: 'error',
      }),
    );
  });

  test('creates an order lifecycle job with order-scoped dedupe and event payloads', async () => {
    mockFindActiveIntegrationJobByDedupeKey.mockResolvedValue(null);
    mockCreateIntegrationJob.mockResolvedValue({
      integration_job_id: 108,
      job_kind: 'ORDER_STATUS_POLL',
      vendor_id: 21,
      mapping_id: null,
      order_integration_state_id: 55,
      sync_scope: 'ALL',
      source_action: 'scheduler_status_poll',
      dedupe_key: 'order_job:ORDER_STATUS_POLL:21:55',
      correlation_id: 'corr-order-1',
      request_payload: { scheduled_at: '2026-03-19T00:00:00.000Z' },
      status: 'PENDING',
      attempt_count: 0,
      queue_message_id: null,
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });
    mockSqsSend.mockResolvedValue({ MessageId: 'message-108' });
    mockMarkIntegrationJobEnqueued.mockResolvedValue({
      integration_job_id: 108,
      job_kind: 'ORDER_STATUS_POLL',
      vendor_id: 21,
      mapping_id: null,
      order_integration_state_id: 55,
      sync_scope: 'ALL',
      source_action: 'scheduler_status_poll',
      dedupe_key: 'order_job:ORDER_STATUS_POLL:21:55',
      correlation_id: 'corr-order-1',
      request_payload: { scheduled_at: '2026-03-19T00:00:00.000Z' },
      status: 'ENQUEUED',
      attempt_count: 0,
      queue_message_id: 'message-108',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });

    const { submitOrderLifecycleJob } = await import('@lib/integrationJobs');
    const result = await submitOrderLifecycleJob({
      vendorId: 21,
      orderIntegrationStateId: 55,
      jobKind: 'ORDER_STATUS_POLL',
      sourceAction: 'scheduler_status_poll',
      correlationId: 'corr-order-1',
      requestPayload: { scheduled_at: '2026-03-19T00:00:00.000Z' },
    });

    expect(mockCreateIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        job_kind: 'ORDER_STATUS_POLL',
        vendor_id: 21,
        order_integration_state_id: 55,
        dedupe_key: 'order_job:ORDER_STATUS_POLL:21:55',
      }),
    );
    expect(mockPublishPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detailType: 'order.job.submitted',
        detail: expect.objectContaining({
          order_integration_state_id: 55,
          job_kind: 'ORDER_STATUS_POLL',
        }),
      }),
    );
    expect(result.job.status).toBe('ENQUEUED');
    expect(result.deduplicated).toBe(false);
  });
});
