export {};

const mockGetSystemSessionContext = jest.fn();
const mockCreateIntegrationJobEvent = jest.fn();
const mockFinalizeIntegrationJob = jest.fn();
const mockGetIntegrationJobById = jest.fn();
const mockMarkIntegrationJobRunning = jest.fn();
const mockUpdateIntegrationJob = jest.fn();
const mockPublishPlatformEvent = jest.fn();
const mockRunVendorSync = jest.fn();
const mockExecuteOrderLifecycleJob = jest.fn();
const mockWithVendorExecutionLock = jest.fn();
const mockWithOrderIntegrationExecutionLock = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('@lib/auth', () => ({
  getSystemSessionContext: (...args: unknown[]) => mockGetSystemSessionContext(...args),
}));

jest.mock('@lib/platformEvents', () => ({
  publishPlatformEvent: (...args: unknown[]) => mockPublishPlatformEvent(...args),
}));

jest.mock('@lib/etl/runner', () => ({
  runVendorSync: (...args: unknown[]) => mockRunVendorSync(...args),
}));

jest.mock('@lib/orders/orderExecution', () => ({
  executeOrderLifecycleJob: (...args: unknown[]) => mockExecuteOrderLifecycleJob(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  createIntegrationJobEvent: (...args: unknown[]) => mockCreateIntegrationJobEvent(...args),
  finalizeIntegrationJob: (...args: unknown[]) => mockFinalizeIntegrationJob(...args),
  getIntegrationJobById: (...args: unknown[]) => mockGetIntegrationJobById(...args),
  markIntegrationJobRunning: (...args: unknown[]) => mockMarkIntegrationJobRunning(...args),
  updateIntegrationJob: (...args: unknown[]) => mockUpdateIntegrationJob(...args),
}));

jest.mock('@lib/vendorExecutionLock', () => ({
  withVendorExecutionLock: (...args: unknown[]) => mockWithVendorExecutionLock(...args),
  withOrderIntegrationExecutionLock: (...args: unknown[]) => mockWithOrderIntegrationExecutionLock(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

describe('integration job worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.INTEGRATION_JOB_MAX_RECEIVE_COUNT = '5';

    mockGetIntegrationJobById.mockResolvedValue({
      integration_job_id: 90,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 14,
      mapping_id: 33,
      sync_scope: 'MAPPING',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:14:MAPPING:33:manual_sync',
      correlation_id: 'corr-90',
      request_payload: {},
      status: 'ENQUEUED',
      attempt_count: 1,
      queue_message_id: 'message-90',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });
    mockMarkIntegrationJobRunning.mockResolvedValue({
      integration_job_id: 90,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 14,
      mapping_id: 33,
      sync_scope: 'MAPPING',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:14:MAPPING:33:manual_sync',
      correlation_id: 'corr-90',
      request_payload: {},
      status: 'RUNNING',
      attempt_count: 2,
      queue_message_id: 'message-90',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
    });
    mockGetSystemSessionContext.mockResolvedValue({
      accessToken: 'token',
      storeHash: 'storehash',
      user: {
        id: 0,
        email: 'system@merchmonk.local',
      },
    });
    mockRunVendorSync.mockResolvedValue({
      syncRunId: 123,
      recordsRead: 10,
      recordsWritten: 8,
      endpointResults: [],
    });
    mockExecuteOrderLifecycleJob.mockResolvedValue({
      orderIntegrationState: {
        order_integration_state_id: 71,
        lifecycle_status: 'SUBMITTED',
      },
      summary: {
        lifecycle_status: 'SUBMITTED',
      },
    });
  });

  test('runs the existing sync runner and marks the integration job successful', async () => {
    mockWithVendorExecutionLock.mockImplementation(async (_vendorId, callback) => {
      await callback();
      return { acquired: true };
    });

    const { handler } = await import('../../workers/integrationJobWorker');
    await handler({
      Records: [
        {
          body: JSON.stringify({ integrationJobId: 90 }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    });

    expect(mockMarkIntegrationJobRunning).toHaveBeenCalledWith(90, 2);
    expect(mockRunVendorSync).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 14,
        mappingId: 33,
        syncAll: false,
      }),
    );
    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'SUCCEEDED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_started',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_succeeded',
      }),
    );
  });

  test('keeps the job enqueued when the vendor lock is unavailable', async () => {
    mockWithVendorExecutionLock.mockResolvedValue({ acquired: false });

    const { handler } = await import('../../workers/integrationJobWorker');

    await expect(
      handler({
        Records: [
          {
            body: JSON.stringify({ integrationJobId: 90 }),
            attributes: { ApproximateReceiveCount: '2' },
          },
        ],
      }),
    ).rejects.toThrow('Vendor 14 is already running a sync job.');

    expect(mockUpdateIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'ENQUEUED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_lock_unavailable',
        level: 'warn',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_retry_scheduled',
        level: 'warn',
      }),
    );
  });

  test('marks non-retryable catalog sync configuration failures as failed immediately', async () => {
    mockWithVendorExecutionLock.mockImplementation(async (_vendorId, callback) => {
      await callback();
      return { acquired: true };
    });
    mockGetSystemSessionContext.mockRejectedValue(
      new Error('No BigCommerce store connection is configured for background execution.'),
    );

    const { handler } = await import('../../workers/integrationJobWorker');

    await expect(
      handler({
        Records: [
          {
            body: JSON.stringify({ integrationJobId: 90 }),
            attributes: { ApproximateReceiveCount: '1' },
          },
        ],
      }),
    ).rejects.toThrow('No BigCommerce store connection is configured for background execution.');

    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'FAILED',
      }),
    );
    expect(mockUpdateIntegrationJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'ENQUEUED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_failed',
        level: 'error',
      }),
    );
  });

  test('marks deterministic ProductData SOAP faults as failed immediately instead of retrying', async () => {
    mockWithVendorExecutionLock.mockImplementation(async (_vendorId, callback) => {
      await callback();
      return { acquired: true };
    });
    mockRunVendorSync.mockRejectedValue(
      new Error('ProductData discovery failed before any product IDs were found. getProductSellable: WsVersion not found.'),
    );

    const { handler } = await import('../../workers/integrationJobWorker');

    await expect(
      handler({
        Records: [
          {
            body: JSON.stringify({ integrationJobId: 90 }),
            attributes: { ApproximateReceiveCount: '1' },
          },
        ],
      }),
    ).rejects.toThrow(
      'ProductData discovery failed before any product IDs were found. getProductSellable: WsVersion not found.',
    );

    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'FAILED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_failed',
        level: 'error',
      }),
    );
  });

  test('marks BigCommerce 422 validation failures as failed immediately instead of retrying', async () => {
    mockWithVendorExecutionLock.mockImplementation(async (_vendorId, callback) => {
      await callback();
      return { acquired: true };
    });
    mockRunVendorSync.mockRejectedValue(
      new Error(
        'Failed to create BigCommerce category (422): {"status":422,"errors":{"name":"name must have a length between 1 and 50"}}',
      ),
    );

    const { handler } = await import('../../workers/integrationJobWorker');

    await expect(
      handler({
        Records: [
          {
            body: JSON.stringify({ integrationJobId: 90 }),
            attributes: { ApproximateReceiveCount: '1' },
          },
        ],
      }),
    ).rejects.toThrow('Failed to create BigCommerce category (422)');

    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'FAILED',
      }),
    );
    expect(mockUpdateIntegrationJob).not.toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'ENQUEUED',
      }),
    );
  });

  test('marks a cancel-requested job as cancelled before execution starts', async () => {
    mockGetIntegrationJobById.mockResolvedValue({
      integration_job_id: 90,
      job_kind: 'CATALOG_SYNC',
      vendor_id: 14,
      mapping_id: 33,
      sync_scope: 'MAPPING',
      source_action: 'manual_sync',
      dedupe_key: 'catalog_sync:14:MAPPING:33:manual_sync',
      correlation_id: 'corr-90',
      request_payload: {},
      status: 'CANCEL_REQUESTED',
      attempt_count: 1,
      queue_message_id: 'message-90',
      last_error: 'Cancellation requested by operator.',
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });

    const { handler } = await import('../../workers/integrationJobWorker');
    await handler({
      Records: [
        {
          body: JSON.stringify({ integrationJobId: 90 }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    });

    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'CANCELLED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_cancelled',
      }),
    );
    expect(mockMarkIntegrationJobRunning).not.toHaveBeenCalled();
  });

  test('marks a running job as cancelled when the sync runner raises a cancellation error', async () => {
    mockWithVendorExecutionLock.mockImplementation(async (_vendorId, callback) => {
      await callback();
      return { acquired: true };
    });
    const cancellationError = new Error('Integration job 90 was cancelled by operator.');
    cancellationError.name = 'IntegrationJobCancelledError';
    mockRunVendorSync.mockRejectedValue(cancellationError);

    const { handler } = await import('../../workers/integrationJobWorker');
    await handler({
      Records: [
        {
          body: JSON.stringify({ integrationJobId: 90 }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    });

    expect(mockFinalizeIntegrationJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        status: 'CANCELLED',
      }),
    );
    expect(mockCreateIntegrationJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 90,
        event_name: 'job_cancelled',
      }),
    );
  });

  test('executes order lifecycle jobs with the order lock and order events', async () => {
    mockGetIntegrationJobById.mockResolvedValue({
      integration_job_id: 144,
      job_kind: 'ORDER_STATUS_POLL',
      vendor_id: 14,
      mapping_id: null,
      order_integration_state_id: 71,
      sync_scope: 'ALL',
      source_action: 'scheduler_status_poll',
      dedupe_key: 'order_job:ORDER_STATUS_POLL:14:71',
      correlation_id: 'corr-144',
      request_payload: {},
      status: 'ENQUEUED',
      attempt_count: 0,
      queue_message_id: 'message-144',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: null,
      ended_at: null,
    });
    mockMarkIntegrationJobRunning.mockResolvedValue({
      integration_job_id: 144,
      job_kind: 'ORDER_STATUS_POLL',
      vendor_id: 14,
      mapping_id: null,
      order_integration_state_id: 71,
      sync_scope: 'ALL',
      source_action: 'scheduler_status_poll',
      dedupe_key: 'order_job:ORDER_STATUS_POLL:14:71',
      correlation_id: 'corr-144',
      request_payload: {},
      status: 'RUNNING',
      attempt_count: 1,
      queue_message_id: 'message-144',
      last_error: null,
      submitted_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      ended_at: null,
    });
    mockWithOrderIntegrationExecutionLock.mockImplementation(async (_orderIntegrationStateId, callback) => {
      await callback();
      return { acquired: true };
    });

    const { handler } = await import('../../workers/integrationJobWorker');
    await handler({
      Records: [
        {
          body: JSON.stringify({ integrationJobId: 144 }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    });

    expect(mockExecuteOrderLifecycleJob).toHaveBeenCalledWith(
      expect.objectContaining({
        integration_job_id: 144,
        order_integration_state_id: 71,
        job_kind: 'ORDER_STATUS_POLL',
      }),
    );
    expect(mockPublishPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detailType: 'order.job.started',
      }),
    );
    expect(mockPublishPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detailType: 'order.job.succeeded',
      }),
    );
  });
});
