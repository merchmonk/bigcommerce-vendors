import { runVendorSync } from '@lib/etl/runner';

const mockGetVendorById = jest.fn();
const mockCreateSyncRun = jest.fn();
const mockMarkSyncRunRunning = jest.fn();
const mockCompleteSyncRun = jest.fn();
const mockListEnabledVendorEndpointMappings = jest.fn();
const mockListSyncRunsForVendor = jest.fn();
const mockUpsertVendorProductMap = jest.fn();
const mockUpsertBigCommerceProduct = jest.fn();
const mockDiscoverProductDataReferences = jest.fn();
const mockFetchProductDataReference = jest.fn();
const mockBuildProductAssembly = jest.fn();
const mockUpsertPendingRelatedProductLink = jest.fn();
const mockUpsertProductEnrichmentRetry = jest.fn();
const mockClearProductEnrichmentRetry = jest.fn();
const mockListPendingRelatedProductLinks = jest.fn();
const mockFindVendorProductMapByVendorProductId = jest.fn();
const mockGetIntegrationJobById = jest.fn();
const mockUpdateSyncRunProgress = jest.fn();
const mockUpsertRelatedProducts = jest.fn();
const mockResolveBigCommercePricingContext = jest.fn();
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('@lib/vendors', () => ({
  getVendorById: (...args: unknown[]) => mockGetVendorById(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  createSyncRun: (...args: unknown[]) => mockCreateSyncRun(...args),
  markSyncRunRunning: (...args: unknown[]) => mockMarkSyncRunRunning(...args),
  completeSyncRun: (...args: unknown[]) => mockCompleteSyncRun(...args),
  listEnabledVendorEndpointMappings: (...args: unknown[]) => mockListEnabledVendorEndpointMappings(...args),
  listSyncRunsForVendor: (...args: unknown[]) => mockListSyncRunsForVendor(...args),
  upsertVendorProductMap: (...args: unknown[]) => mockUpsertVendorProductMap(...args),
  upsertPendingRelatedProductLink: (...args: unknown[]) => mockUpsertPendingRelatedProductLink(...args),
  upsertProductEnrichmentRetry: (...args: unknown[]) => mockUpsertProductEnrichmentRetry(...args),
  clearProductEnrichmentRetry: (...args: unknown[]) => mockClearProductEnrichmentRetry(...args),
  listPendingRelatedProductLinks: (...args: unknown[]) => mockListPendingRelatedProductLinks(...args),
  findVendorProductMapByVendorProductId: (...args: unknown[]) => mockFindVendorProductMapByVendorProductId(...args),
  getIntegrationJobById: (...args: unknown[]) => mockGetIntegrationJobById(...args),
  updateSyncRunProgress: (...args: unknown[]) => mockUpdateSyncRunProgress(...args),
}));

jest.mock('@lib/etl/bigcommerceCatalog', () => ({
  upsertBigCommerceProduct: (...args: unknown[]) => mockUpsertBigCommerceProduct(...args),
  upsertRelatedProducts: (...args: unknown[]) => mockUpsertRelatedProducts(...args),
}));

jest.mock('@lib/etl/bigcommercePricingContext', () => ({
  resolveBigCommercePricingContext: (...args: unknown[]) => mockResolveBigCommercePricingContext(...args),
}));

jest.mock('@lib/etl/adapters/factory', () => ({
  resolveEndpointAdapter: () => ({
    protocol: 'SOAP',
    testConnection: jest.fn(),
    invokeEndpoint: jest.fn(),
  }),
}));

jest.mock('@lib/etl/productDataWorkflow', () => ({
  discoverProductDataReferences: (...args: unknown[]) => mockDiscoverProductDataReferences(...args),
  fetchProductDataReference: (...args: unknown[]) => mockFetchProductDataReference(...args),
}));

jest.mock('@lib/etl/productEnrichment', () => ({
  buildProductAssembly: (...args: unknown[]) => mockBuildProductAssembly(...args),
}));

jest.mock('@lib/logger', () => ({
  __esModule: true,
  default: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
  },
}));

describe('runVendorSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateSyncRun.mockResolvedValue({ sync_run_id: 11 });
    mockMarkSyncRunRunning.mockResolvedValue({ sync_run_id: 11 });
    mockCompleteSyncRun.mockResolvedValue({ sync_run_id: 11, status: 'SUCCESS' });
    mockGetVendorById.mockResolvedValue({
      vendor_id: 7,
      vendor_api_url: 'https://vendor.example.com',
      vendor_account_id: 'acct',
      vendor_secret: 'secret',
      api_protocol: 'SOAP',
    });
    mockListSyncRunsForVendor.mockResolvedValue([]);
    mockListEnabledVendorEndpointMappings.mockResolvedValue([
      {
        mapping_id: 100,
        runtime_config: {},
        mapping: {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
          protocol: 'SOAP',
          is_product_endpoint: true,
          transform_schema: {},
        },
      },
      {
        mapping_id: 200,
        runtime_config: {},
        mapping: {
          mapping_id: 200,
          endpoint_name: 'Inventory',
          endpoint_version: '1.2.1',
          operation_name: 'getInventoryLevels',
          protocol: 'SOAP',
          is_product_endpoint: true,
          transform_schema: {},
        },
      },
    ]);
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: 1,
        },
      ],
      references: [{ productId: 'PROD-1', partId: 'SKU-1' }],
      getProductConfig: {
        mapping: {
          mapping_id: 101,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
        },
        runtimeConfig: {},
        endpointUrl: 'https://vendor.example.com/productdata',
        localizationCountry: 'US',
        localizationLanguage: 'en',
      },
    });
    mockFetchProductDataReference.mockResolvedValue({
      status: 200,
      products: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'PROD-1',
          name: 'Example',
          cost_price: 10,
        },
      ],
    });
    mockBuildProductAssembly.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 200,
          endpoint_name: 'Inventory',
          endpoint_version: '1.2.1',
          operation_name: 'getInventoryLevels',
          status: 200,
          products_found: 1,
        },
      ],
      products: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'PROD-1',
          name: 'Example',
          cost_price: 10,
          enrichment_status: {
            pricing: 'SUCCESS',
            inventory: 'SUCCESS',
            media: 'SUCCESS',
            gating_reasons: [],
          },
        },
      ],
      statuses: [],
      mediaRetries: [],
    });
    mockUpsertBigCommerceProduct.mockResolvedValue({
      product: { id: 999, sku: 'SKU-1', name: 'Example' },
      duplicate: false,
      action: 'create',
      resolvedSku: 'SKU-1',
      markupPercent: 30,
    });
    mockUpsertVendorProductMap.mockResolvedValue({});
    mockListPendingRelatedProductLinks.mockResolvedValue([]);
    mockFindVendorProductMapByVendorProductId.mockResolvedValue(null);
    mockGetIntegrationJobById.mockResolvedValue(null);
    mockUpdateSyncRunProgress.mockResolvedValue({});
    mockUpsertRelatedProducts.mockResolvedValue(undefined);
    mockResolveBigCommercePricingContext.mockResolvedValue({
      markup_percent: 30,
      price_list_id: 1,
      currency: 'USD',
      markup_namespace: 'merchmonk',
      markup_key: 'product_markup',
    });
  });

  test('runs product assembly flow, writes BigCommerce product, and finalizes sync run', async () => {
    const result = await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
    });

    expect(mockDiscoverProductDataReferences).toHaveBeenCalledTimes(1);
    expect(mockDiscoverProductDataReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSuccessfulSyncAt: null,
      }),
    );
    expect(mockFetchProductDataReference).toHaveBeenCalledTimes(1);
    expect(mockBuildProductAssembly).toHaveBeenCalledTimes(1);
    expect(mockUpsertBigCommerceProduct).toHaveBeenCalledTimes(1);
    expect(mockUpsertVendorProductMap).toHaveBeenCalledTimes(1);
    expect(result.recordsWritten).toBe(1);
    expect(mockUpdateSyncRunProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_run_id: 11,
        details: expect.objectContaining({
          endpointResults: expect.arrayContaining([
            expect.objectContaining({
              endpoint_name: 'ProductData',
            }),
            expect.objectContaining({
              endpoint_name: 'Inventory',
            }),
          ]),
        }),
      }),
    );
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_run_id: 11,
        status: 'SUCCESS',
      }),
    );
  });

  test('passes the previous successful sync completion time into ProductData discovery', async () => {
    mockListSyncRunsForVendor.mockResolvedValue([
      {
        sync_run_id: 10,
        status: 'SUCCESS',
        started_at: '2026-03-20T18:00:00.000Z',
        ended_at: '2026-03-20T18:45:00.000Z',
      },
    ]);

    await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
    });

    expect(mockDiscoverProductDataReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSuccessfulSyncAt: '2026-03-20T18:45:00.000Z',
      }),
    );
  });

  test('resolves deferred related-product links when mapped ids are available', async () => {
    mockBuildProductAssembly.mockResolvedValue({
      endpointResults: [],
      products: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'PROD-1',
          name: 'Example',
          related_vendor_product_ids: ['PROD-2'],
          enrichment_status: {
            pricing: 'SUCCESS',
            inventory: 'SUCCESS',
            media: 'SUCCESS',
            gating_reasons: [],
          },
        },
      ],
      statuses: [],
      mediaRetries: [],
    });
    mockListPendingRelatedProductLinks.mockResolvedValue([
      {
        pending_related_product_link_id: 1,
        vendor_id: 7,
        source_vendor_product_id: 'PROD-1',
        target_vendor_product_id: 'PROD-2',
        source_bigcommerce_product_id: null,
        target_bigcommerce_product_id: null,
        status: 'PENDING',
        retry_count: 0,
        last_error: null,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        resolved_at: null,
      },
    ]);
    mockFindVendorProductMapByVendorProductId
      .mockResolvedValueOnce({
        bigcommerce_product_id: 9001,
      })
      .mockResolvedValueOnce({
        bigcommerce_product_id: 9002,
      });

    await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
    });

    expect(mockUpsertPendingRelatedProductLink).toHaveBeenCalledWith(
      expect.objectContaining({
        source_vendor_product_id: 'PROD-1',
        target_vendor_product_id: 'PROD-2',
        status: 'PENDING',
      }),
    );
    expect(mockUpsertRelatedProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceProductId: 9001,
        targetProductIds: [9002],
      }),
    );
  });

  test('fails fast when discovery finds products but enrichment blocks all products before any BigCommerce writes', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [],
      references: [{ productId: 'PROD-1', partId: 'SKU-1' }],
      getProductConfig: {
        mapping: {
          mapping_id: 101,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
        },
        runtimeConfig: {},
        endpointUrl: 'https://vendor.example.com/productdata',
        localizationCountry: 'US',
        localizationLanguage: 'en',
      },
    });
    mockFetchProductDataReference.mockResolvedValue({
      status: 200,
      products: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'PROD-1',
          name: 'Example',
          cost_price: 10,
        },
      ],
    });
    mockBuildProductAssembly.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 200,
          endpoint_name: 'Inventory',
          endpoint_version: '1.2.1',
          operation_name: 'getInventoryLevels',
          status: 500,
          products_found: 0,
          message: 'Inventory call failed',
        },
      ],
      products: [],
      statuses: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'PROD-1',
          blocked: true,
          gating_reasons: ['Inventory enrichment failed.'],
          enrichment_status: {
            pricing: 'SUCCESS',
            inventory: 'FAILED',
            media: 'SUCCESS',
            gating_reasons: ['Inventory enrichment failed.'],
            media_errors: [],
          },
        },
      ],
      mediaRetries: [],
    });

    await expect(
      runVendorSync({
        vendorId: 7,
        session: {
          accessToken: 'token',
          storeHash: 'storehash',
          user: { id: 1, email: 'test@example.com' },
        },
        syncAll: true,
      }),
    ).rejects.toThrow('Vendor sync halted before BigCommerce write');

    expect(mockUpsertBigCommerceProduct).not.toHaveBeenCalled();
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_run_id: 11,
        status: 'FAILED',
        details: expect.objectContaining({
          productStatuses: expect.arrayContaining([
            expect.objectContaining({
              sku: 'SKU-1',
              blocked: true,
            }),
          ]),
        }),
      }),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'vendor sync failed',
      expect.objectContaining({
        syncRunId: 11,
      }),
    );
  });
});
