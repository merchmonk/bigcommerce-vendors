export {};

const mockGetSession = jest.fn();
const mockRecordInternalFailure = jest.fn();
const mockCancelIntegrationJob = jest.fn();
const mockGetActiveCatalogSyncJobForVendor = jest.fn();
const mockGetIntegrationJobStatus = jest.fn();
const mockSubmitCatalogSyncJob = jest.fn();
const mockBuildApiRequestContext = jest.fn();
const mockGetRequestContext = jest.fn();
const mockRunWithRequestContext = jest.fn();
const mockListSyncRunsForVendor = jest.fn();
const mockReconcileStaleCatalogSyncRunsForVendor = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('@lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@lib/apiTelemetry', () => ({
  recordInternalFailure: (...args: unknown[]) => mockRecordInternalFailure(...args),
}));

jest.mock('@lib/integrationJobs', () => ({
  cancelIntegrationJob: (...args: unknown[]) => mockCancelIntegrationJob(...args),
  getActiveCatalogSyncJobForVendor: (...args: unknown[]) => mockGetActiveCatalogSyncJobForVendor(...args),
  getIntegrationJobStatus: (...args: unknown[]) => mockGetIntegrationJobStatus(...args),
  submitCatalogSyncJob: (...args: unknown[]) => mockSubmitCatalogSyncJob(...args),
}));

jest.mock('@lib/requestContext', () => ({
  buildApiRequestContext: (...args: unknown[]) => mockBuildApiRequestContext(...args),
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
  runWithRequestContext: (...args: unknown[]) => mockRunWithRequestContext(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  listSyncRunsForVendor: (...args: unknown[]) => mockListSyncRunsForVendor(...args),
  reconcileStaleCatalogSyncRunsForVendor: (...args: unknown[]) => mockReconcileStaleCatalogSyncRunsForVendor(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string[]>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string[]) {
      this.headers[name] = value;
    },
    end(payload?: unknown) {
      this.body = payload;
      return this;
    },
  };
}

describe('/api/vendors/[vendorId]/sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildApiRequestContext.mockReturnValue({ correlationId: 'corr-1' });
    mockGetRequestContext.mockReturnValue({ correlationId: 'corr-1' });
    mockRunWithRequestContext.mockImplementation(async (_context, callback) => callback());
    mockGetSession.mockResolvedValue({ user: { id: 1, email: 'ops@example.com' } });
  });

  test('returns the latest resumable checkpoint for a failed all-products sync run', async () => {
    mockReconcileStaleCatalogSyncRunsForVendor.mockResolvedValue(0);
    mockGetActiveCatalogSyncJobForVendor.mockResolvedValue(null);
    mockListSyncRunsForVendor.mockResolvedValue([
      {
        etl_sync_run_id: 213,
        vendor_id: 14,
        endpoint_mapping_id: null,
        sync_scope: 'ALL',
        status: 'FAILED',
        started_at: '2026-04-02T16:00:00.000Z',
        ended_at: '2026-04-02T16:32:00.000Z',
        records_read: 275,
        records_written: 275,
        error_message: 'BigCommerce modifier create failed.',
        details: {
          phase: 'UPSERT',
          progress: {
            processed_references: 275,
            current_product_id: '100882',
            current_sku: '100882-275',
          },
        },
      },
      {
        etl_sync_run_id: 212,
        vendor_id: 14,
        endpoint_mapping_id: null,
        sync_scope: 'ALL',
        status: 'SUCCESS',
        started_at: '2026-04-02T15:00:00.000Z',
        ended_at: '2026-04-02T15:45:00.000Z',
        records_read: 100,
        records_written: 100,
        error_message: null,
        details: {},
      },
    ]);

    const handler = (await import('@pages/api/vendors/[vendorId]/sync')).default;
    const res = createResponse();

    await handler(
      {
        method: 'GET',
        query: { vendorId: '14' },
        body: {},
      } as any,
      res as any,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      data: expect.any(Array),
      active_job: null,
      resume_checkpoint: {
        sync_run_id: 213,
        start_reference_index: 275,
        status: 'FAILED',
        last_processed_product_id: '100882',
        last_processed_sku: '100882-275',
      },
    });
  });

  test('submits a manual sync with a continuation start index and batch size', async () => {
    mockSubmitCatalogSyncJob.mockResolvedValue({
      deduplicated: false,
      job: { integration_job_id: 901, vendor_id: 14, status: 'ENQUEUED' },
    });
    mockGetIntegrationJobStatus.mockResolvedValue({
      job: { integration_job_id: 901, vendor_id: 14, status: 'ENQUEUED' },
      events: [],
    });

    const handler = (await import('@pages/api/vendors/[vendorId]/sync')).default;
    const res = createResponse();

    await handler(
      {
        method: 'POST',
        query: { vendorId: '14' },
        body: {
          sync_all: true,
          start_reference_index: 283,
          max_references_per_run: 10,
        },
      } as any,
      res as any,
    );

    expect(mockSubmitCatalogSyncJob).toHaveBeenCalledWith({
      vendorId: 14,
      mappingId: undefined,
      syncAll: true,
      sourceAction: 'manual_sync',
      correlationId: 'corr-1',
      requestPayload: {
        mapping_id: null,
        sync_all: true,
        continuation: {
          start_reference_index: 283,
          max_references_per_run: 10,
        },
      },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({
      data: { integration_job_id: 901, vendor_id: 14, status: 'ENQUEUED' },
      events: [],
      deduplicated: false,
    });
  });

  test('rejects an invalid continuation start index', async () => {
    const handler = (await import('@pages/api/vendors/[vendorId]/sync')).default;
    const res = createResponse();

    await handler(
      {
        method: 'POST',
        query: { vendorId: '14' },
        body: {
          sync_all: true,
          start_reference_index: -1,
        },
      } as any,
      res as any,
    );

    expect(mockSubmitCatalogSyncJob).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'start_reference_index must be an integer greater than or equal to 0.',
    });
  });
});
