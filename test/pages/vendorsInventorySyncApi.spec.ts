const mockGetSession = jest.fn();
const mockRecordInternalFailure = jest.fn();
const mockSubmitCatalogSyncJob = jest.fn();
const mockListVendors = jest.fn();
const mockListEnabledVendorEndpointMappings = jest.fn();
const mockBuildApiRequestContext = jest.fn();
const mockGetRequestContext = jest.fn();
const mockRunWithRequestContext = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock('@lib/auth', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@lib/apiTelemetry', () => ({
  recordInternalFailure: (...args: unknown[]) => mockRecordInternalFailure(...args),
}));

jest.mock('@lib/integrationJobs', () => ({
  submitCatalogSyncJob: (...args: unknown[]) => mockSubmitCatalogSyncJob(...args),
}));

jest.mock('@lib/vendors', () => ({
  listVendors: (...args: unknown[]) => mockListVendors(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  listEnabledVendorEndpointMappings: (...args: unknown[]) => mockListEnabledVendorEndpointMappings(...args),
}));

jest.mock('@lib/requestContext', () => ({
  buildApiRequestContext: (...args: unknown[]) => mockBuildApiRequestContext(...args),
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
  runWithRequestContext: (...args: unknown[]) => mockRunWithRequestContext(...args),
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

describe('/api/vendors/inventory-sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildApiRequestContext.mockReturnValue({ correlationId: 'corr-1' });
    mockGetRequestContext.mockReturnValue({ correlationId: 'corr-1' });
    mockRunWithRequestContext.mockImplementation(async (_context, callback) => callback());
  });

  test('submits inventory-only sync jobs for active vendors with inventory mappings', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 1, email: 'ops@example.com' } });
    mockListVendors.mockResolvedValue([
      { vendor_id: 6, vendor_name: 'Vendor One', is_active: true },
      { vendor_id: 7, vendor_name: 'Vendor Two', is_active: true },
      { vendor_id: 8, vendor_name: 'Vendor Three', is_active: true },
    ]);
    mockListEnabledVendorEndpointMappings
      .mockResolvedValueOnce([
        {
          mapping_id: 101,
          mapping: {
            mapping_id: 101,
            endpoint_name: 'ProductData',
            endpoint_version: '2.0.0',
            operation_name: 'getProduct',
          },
        },
        {
          mapping_id: 102,
          mapping: {
            mapping_id: 102,
            endpoint_name: 'Inventory',
            endpoint_version: '1.2.1',
            operation_name: 'getInventoryLevels',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          mapping_id: 202,
          mapping: {
            mapping_id: 202,
            endpoint_name: 'Inventory',
            endpoint_version: '1.2.1',
            operation_name: 'getInventoryLevels',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          mapping_id: 301,
          mapping: {
            mapping_id: 301,
            endpoint_name: 'ProductMedia',
            endpoint_version: '1.0.0',
            operation_name: 'getMediaContent',
          },
        },
      ]);
    mockSubmitCatalogSyncJob
      .mockResolvedValueOnce({
        deduplicated: false,
        job: { integration_job_id: 501, vendor_id: 6, mapping_id: 102, status: 'ENQUEUED' },
      })
      .mockResolvedValueOnce({
        deduplicated: true,
        job: { integration_job_id: 502, vendor_id: 7, mapping_id: 202, status: 'ENQUEUED' },
      });

    const handler = (await import('@pages/api/vendors/inventory-sync')).default;
    const res = createResponse();

    await handler({ method: 'POST', query: { context: 'store-context' }, body: {} } as any, res as any);

    expect(mockListVendors).toHaveBeenCalledWith(false);
    expect(mockSubmitCatalogSyncJob).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        vendorId: 6,
        mappingId: 102,
        sourceAction: 'manual_inventory_sync',
      }),
    );
    expect(mockSubmitCatalogSyncJob).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        vendorId: 7,
        mappingId: 202,
        sourceAction: 'manual_inventory_sync',
      }),
    );
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({
      data: [
        {
          vendor_id: 6,
          vendor_name: 'Vendor One',
          mapping_id: 102,
          job: { integration_job_id: 501, vendor_id: 6, mapping_id: 102, status: 'ENQUEUED' },
          deduplicated: false,
        },
        {
          vendor_id: 7,
          vendor_name: 'Vendor Two',
          mapping_id: 202,
          job: { integration_job_id: 502, vendor_id: 7, mapping_id: 202, status: 'ENQUEUED' },
          deduplicated: true,
        },
        {
          vendor_id: 8,
          vendor_name: 'Vendor Three',
          mapping_id: null,
          job: null,
          deduplicated: false,
          skipped_reason: 'No enabled Inventory mapping found for this vendor.',
        },
      ],
      summary: {
        active_vendor_count: 3,
        submitted_count: 2,
        deduplicated_count: 1,
        skipped_count: 1,
      },
    });
  });

  test('returns unauthorized when there is no session', async () => {
    mockGetSession.mockResolvedValue(null);

    const handler = (await import('@pages/api/vendors/inventory-sync')).default;
    const res = createResponse();

    await handler({ method: 'POST', query: { context: 'store-context' }, body: {} } as any, res as any);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Unauthorized' });
  });
});
