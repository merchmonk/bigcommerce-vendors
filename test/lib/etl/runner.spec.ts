import { runVendorSync } from '@lib/etl/runner';

const mockGetVendorById = jest.fn();
const mockCreateSyncRun = jest.fn();
const mockMarkSyncRunRunning = jest.fn();
const mockCompleteSyncRun = jest.fn();
const mockListEnabledVendorEndpointMappings = jest.fn();
const mockUpsertVendorProductMap = jest.fn();
const mockUpsertBigCommerceProduct = jest.fn();
const mockRunProductDataWorkflow = jest.fn();
const mockBuildProductAssembly = jest.fn();
const mockUpsertPendingRelatedProductLink = jest.fn();
const mockUpsertProductEnrichmentRetry = jest.fn();
const mockClearProductEnrichmentRetry = jest.fn();
const mockListPendingRelatedProductLinks = jest.fn();
const mockFindVendorProductMapByVendorProductId = jest.fn();
const mockUpsertRelatedProducts = jest.fn();
const mockResolveBigCommercePricingContext = jest.fn();

jest.mock('@lib/vendors', () => ({
  getVendorById: (...args: unknown[]) => mockGetVendorById(...args),
}));

jest.mock('@lib/etl/repository', () => ({
  createSyncRun: (...args: unknown[]) => mockCreateSyncRun(...args),
  markSyncRunRunning: (...args: unknown[]) => mockMarkSyncRunRunning(...args),
  completeSyncRun: (...args: unknown[]) => mockCompleteSyncRun(...args),
  listEnabledVendorEndpointMappings: (...args: unknown[]) => mockListEnabledVendorEndpointMappings(...args),
  upsertVendorProductMap: (...args: unknown[]) => mockUpsertVendorProductMap(...args),
  upsertPendingRelatedProductLink: (...args: unknown[]) => mockUpsertPendingRelatedProductLink(...args),
  upsertProductEnrichmentRetry: (...args: unknown[]) => mockUpsertProductEnrichmentRetry(...args),
  clearProductEnrichmentRetry: (...args: unknown[]) => mockClearProductEnrichmentRetry(...args),
  listPendingRelatedProductLinks: (...args: unknown[]) => mockListPendingRelatedProductLinks(...args),
  findVendorProductMapByVendorProductId: (...args: unknown[]) => mockFindVendorProductMapByVendorProductId(...args),
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
  runProductDataWorkflow: (...args: unknown[]) => mockRunProductDataWorkflow(...args),
}));

jest.mock('@lib/etl/productEnrichment', () => ({
  buildProductAssembly: (...args: unknown[]) => mockBuildProductAssembly(...args),
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
    mockRunProductDataWorkflow.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
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

    expect(mockRunProductDataWorkflow).toHaveBeenCalledTimes(1);
    expect(mockBuildProductAssembly).toHaveBeenCalledTimes(1);
    expect(mockUpsertBigCommerceProduct).toHaveBeenCalledTimes(1);
    expect(mockUpsertVendorProductMap).toHaveBeenCalledTimes(1);
    expect(result.recordsWritten).toBe(1);
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_run_id: 11,
        status: 'SUCCESS',
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
});
