import { runVendorSync } from '@lib/etl/runner';
import { getRequestContext } from '@lib/requestContext';

const mockGetVendorById = jest.fn();
const mockCreateSyncRun = jest.fn();
const mockMarkSyncRunRunning = jest.fn();
const mockCompleteSyncRun = jest.fn();
const mockListEnabledVendorEndpointMappings = jest.fn();
const mockListSyncRunsForVendor = jest.fn();
const mockUpsertVendorProductMap = jest.fn();
const mockUpsertBigCommerceProduct = jest.fn();
const mockSyncBigCommerceInventoryBatch = jest.fn();
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
const mockReconcileStaleCatalogSyncRunsForVendor = jest.fn();
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
  reconcileStaleCatalogSyncRunsForVendor: (...args: unknown[]) => mockReconcileStaleCatalogSyncRunsForVendor(...args),
  updateSyncRunProgress: (...args: unknown[]) => mockUpdateSyncRunProgress(...args),
}));

jest.mock('@lib/etl/bigcommerceCatalog', () => ({
  upsertBigCommerceProduct: (...args: unknown[]) => mockUpsertBigCommerceProduct(...args),
  upsertRelatedProducts: (...args: unknown[]) => mockUpsertRelatedProducts(...args),
  syncBigCommerceInventoryBatch: (...args: unknown[]) => mockSyncBigCommerceInventoryBatch(...args),
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
    mockCreateSyncRun.mockResolvedValue({ etl_sync_run_id: 11 });
    mockMarkSyncRunRunning.mockResolvedValue({ etl_sync_run_id: 11 });
    mockCompleteSyncRun.mockResolvedValue({ etl_sync_run_id: 11, status: 'SUCCESS' });
    mockGetVendorById.mockResolvedValue({
      vendor_id: 7,
      vendor_name: 'PCNA',
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
      inventory_sync_target: {
        tracking: 'product',
        items: [{ product_id: 999, quantity: 14 }],
      },
    });
    mockUpsertVendorProductMap.mockResolvedValue({});
    mockListPendingRelatedProductLinks.mockResolvedValue([]);
    mockFindVendorProductMapByVendorProductId.mockResolvedValue(null);
    mockGetIntegrationJobById.mockResolvedValue(null);
    mockReconcileStaleCatalogSyncRunsForVendor.mockResolvedValue(0);
    mockUpdateSyncRunProgress.mockResolvedValue({});
    mockUpsertRelatedProducts.mockResolvedValue(undefined);
    mockResolveBigCommercePricingContext.mockResolvedValue({
      markup_percent: 30,
      price_list_id: 1,
      currency: 'USD',
      markup_namespace: 'merchmonk',
      markup_key: 'product_markup',
    });
    mockSyncBigCommerceInventoryBatch.mockResolvedValue(undefined);
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
    expect(mockReconcileStaleCatalogSyncRunsForVendor).toHaveBeenCalledWith(7);
    expect(mockDiscoverProductDataReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSuccessfulSyncAt: null,
      }),
    );
    expect(mockFetchProductDataReference).toHaveBeenCalledTimes(1);
    expect(mockBuildProductAssembly).toHaveBeenCalledTimes(1);
    expect(mockUpsertBigCommerceProduct).toHaveBeenCalledTimes(1);
    expect(mockUpsertBigCommerceProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 7,
        vendorName: 'PCNA',
      }),
    );
    expect(mockSyncBigCommerceInventoryBatch).toHaveBeenCalledWith({
      accessToken: 'token',
      storeHash: 'storehash',
      targets: [
        {
          tracking: 'product',
          items: [{ product_id: 999, quantity: 14 }],
        },
      ],
    });
    expect(mockUpsertVendorProductMap).toHaveBeenCalledTimes(1);
    expect(result.recordsWritten).toBe(1);
    expect(mockUpdateSyncRunProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        etl_sync_run_id: 11,
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
        etl_sync_run_id: 11,
        status: 'SUCCESS',
      }),
    );
  });

  test('uses a product-scoped correlation id during BigCommerce product upserts', async () => {
    const seenCorrelationIds: string[] = [];
    mockUpsertBigCommerceProduct.mockImplementation(async () => {
      seenCorrelationIds.push(getRequestContext()?.correlationId ?? 'missing');
      return {
        product: { id: 999, sku: 'SKU-1', name: 'Example' },
        duplicate: false,
        action: 'create',
        resolvedSku: 'SKU-1',
        markupPercent: 30,
      };
    });

    await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
      integrationJobId: 90,
      sourceAction: 'manual_sync',
      correlationId: 'corr-ctx',
    });

    expect(seenCorrelationIds).toEqual(['corr-ctx:PROD-1:SKU-1']);
  });

  test('flushes pending inventory updates before failing a later product in the same run', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: 2,
        },
      ],
      references: [
        { productId: 'PROD-1', partId: 'SKU-1' },
        { productId: 'PROD-2', partId: 'SKU-2' },
      ],
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

    mockFetchProductDataReference.mockImplementation(async ({ reference }) => ({
      status: 200,
      products: [
        {
          sku: reference.productId === 'PROD-1' ? 'SKU-1' : 'SKU-2',
          vendor_product_id: reference.productId,
          name: reference.productId === 'PROD-1' ? 'Example One' : 'Example Two',
          cost_price: 10,
        },
      ],
    }));

    mockBuildProductAssembly.mockImplementation(async ({ baseProducts }) => ({
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
      products: baseProducts.map((product: { sku: string; vendor_product_id: string; name: string }) => ({
        ...product,
        enrichment_status: {
          pricing: 'SUCCESS',
          inventory: 'SUCCESS',
          media: 'SUCCESS',
          gating_reasons: [],
        },
      })),
      statuses: [],
      mediaRetries: [],
    }));

    mockUpsertBigCommerceProduct
      .mockResolvedValueOnce({
        product: { id: 999, sku: 'SKU-1', name: 'Example One' },
        duplicate: false,
        action: 'update',
        resolvedSku: 'SKU-1',
        markupPercent: 30,
        inventory_sync_target: {
          tracking: 'product',
          items: [{ product_id: 999, quantity: 14 }],
        },
      })
      .mockRejectedValueOnce(new Error('Later product failed'));

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
    ).rejects.toThrow('Later product failed');

    expect(mockSyncBigCommerceInventoryBatch).toHaveBeenCalledWith({
      accessToken: 'token',
      storeHash: 'storehash',
      targets: [
        {
          tracking: 'product',
          items: [{ product_id: 999, quantity: 14 }],
        },
      ],
    });
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'FAILED',
        error_message: 'Later product failed',
      }),
    );
  });

  test('passes the previous successful sync completion time into ProductData discovery', async () => {
    mockListSyncRunsForVendor.mockResolvedValue([
      {
        etl_sync_run_id: 10,
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
      syncAll: false,
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
        etl_sync_run_id: 11,
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

  test('continues sync when a later product is blocked before BigCommerce write but earlier products already synced', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: 2,
        },
      ],
      references: [
        { productId: 'PROD-1', partId: 'SKU-1' },
        { productId: '66P3251', partId: '66P3251-BLK' },
      ],
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

    mockFetchProductDataReference
      .mockResolvedValueOnce({
        status: 200,
        products: [
          {
            sku: 'SKU-1',
            vendor_product_id: 'PROD-1',
            name: 'Example',
            cost_price: 10,
          },
        ],
      })
      .mockResolvedValueOnce({
        status: 200,
        products: [
          {
            sku: '66P3251',
            vendor_product_id: '66P3251',
            name: 'Blocked Product',
          },
        ],
      });

    mockBuildProductAssembly
      .mockResolvedValueOnce({
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
        statuses: [
          {
            sku: 'SKU-1',
            vendor_product_id: 'PROD-1',
            blocked: false,
            gating_reasons: [],
            enrichment_status: {
              pricing: 'SUCCESS',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: [],
            },
          },
        ],
        mediaRetries: [],
      })
      .mockResolvedValueOnce({
        endpointResults: [
          {
            mapping_id: 300,
            endpoint_name: 'PricingAndConfiguration',
            endpoint_version: '1.0.0',
            operation_name: 'getConfigurationAndPricing',
            status: 200,
            products_found: 0,
            message: 'This product cannot be sale in this region!',
          },
        ],
        products: [],
        statuses: [
          {
            sku: '66P3251',
            vendor_product_id: '66P3251',
            blocked: true,
            gating_reasons: ['No pricing data available for product.'],
            enrichment_status: {
              pricing: 'FAILED',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: ['No pricing data available for product.'],
            },
          },
        ],
        mediaRetries: [],
      });

    const result = await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
    });

    expect(result.recordsRead).toBe(2);
    expect(result.recordsWritten).toBe(1);
    expect(mockUpsertBigCommerceProduct).toHaveBeenCalledTimes(1);
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        etl_sync_run_id: 11,
        status: 'SUCCESS',
        records_read: 2,
        records_written: 1,
        details: expect.objectContaining({
          productStatuses: expect.arrayContaining([
            expect.objectContaining({
              sku: '66P3251',
              blocked: true,
              gating_reasons: ['No pricing data available for product.'],
            }),
          ]),
        }),
      }),
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'vendor sync skipped blocked product before BigCommerce write',
      expect.objectContaining({
        syncRunId: 11,
      }),
    );
  });

  test('skips duplicate ProductData fetches when multiple references share the same product id', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: 2,
        },
      ],
      references: [
        { productId: 'PROD-1', partId: 'PROD-1-BLK' },
        { productId: 'PROD-1', partId: 'PROD-1-BLU' },
      ],
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

    mockFetchProductDataReference
      .mockResolvedValueOnce({
        status: 200,
        products: [
          {
            sku: 'SKU-1',
            vendor_product_id: 'PROD-1',
            name: 'Example',
            cost_price: 10,
          },
        ],
      })
      .mockResolvedValueOnce({
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

    await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
    });

    expect(mockFetchProductDataReference).toHaveBeenCalledTimes(1);
    expect(mockBuildProductAssembly).toHaveBeenCalledTimes(1);
    expect(mockUpsertBigCommerceProduct).toHaveBeenCalledTimes(1);
    expect(mockUpsertVendorProductMap).toHaveBeenCalledTimes(1);
  });

  test('persists continuation state after processing one batch of ProductData references', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: 3,
        },
      ],
      references: [
        { productId: 'PROD-2', partId: 'PROD-2-BLK' },
        { productId: 'PROD-1', partId: 'PROD-1-BLK' },
        { productId: 'PROD-3', partId: 'PROD-3-BLK' },
      ],
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

    mockFetchProductDataReference
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'SKU-1', vendor_product_id: 'PROD-1', name: 'One', cost_price: 10 }],
      })
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'SKU-2', vendor_product_id: 'PROD-2', name: 'Two', cost_price: 10 }],
      });

    mockBuildProductAssembly.mockImplementation(async ({ baseProducts }) => ({
      endpointResults: [],
      products: baseProducts.map((product: any) => ({
        ...product,
        enrichment_status: {
          pricing: 'SUCCESS',
          inventory: 'SUCCESS',
          media: 'SUCCESS',
          gating_reasons: [],
        },
      })),
      statuses: baseProducts.map((product: any) => ({
        sku: product.sku,
        vendor_product_id: product.vendor_product_id,
        blocked: false,
        gating_reasons: [],
        enrichment_status: {
          pricing: 'SUCCESS',
          inventory: 'SUCCESS',
          media: 'SUCCESS',
          gating_reasons: [],
        },
      })),
      mediaRetries: [],
    }));

    const result = await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
      integrationJobId: 90,
      sourceAction: 'manual_sync',
      correlationId: 'corr-90',
      continuation: {
        max_references_per_run: 2,
        initial_last_successful_sync_at: '2026-03-20T18:45:00.000Z',
      },
    });

    expect(mockDiscoverProductDataReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSuccessfulSyncAt: '2026-03-20T18:45:00.000Z',
      }),
    );
    expect(mockFetchProductDataReference).toHaveBeenCalledTimes(2);
    expect(mockFetchProductDataReference).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        reference: expect.objectContaining({ productId: 'PROD-1' }),
      }),
    );
    expect(mockFetchProductDataReference).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        reference: expect.objectContaining({ productId: 'PROD-2' }),
      }),
    );
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'SUCCESS',
        details: expect.objectContaining({
          continuation: expect.objectContaining({
            enqueued: false,
            next_start_reference_index: 2,
            total_references: 3,
            max_references_per_run: 2,
            initial_last_successful_sync_at: '2026-03-20T18:45:00.000Z',
            source_action: 'manual_sync',
            correlation_id: 'corr-90',
          }),
        }),
      }),
    );
    expect(result.continuation).toEqual({
      enqueued: false,
      nextStartReferenceIndex: 2,
      totalReferences: 3,
      maxReferencesPerRun: 2,
      initialLastSuccessfulSyncAt: '2026-03-20T18:45:00.000Z',
      sourceAction: 'manual_sync',
      correlationId: 'corr-90',
    });
  });

  test('uses the runtime-safe default batch size when no continuation override is provided', async () => {
    const references = Array.from({ length: 16 }, (_, index) => ({
      productId: `PROD-${String(index + 1).padStart(2, '0')}`,
      partId: `PROD-${String(index + 1).padStart(2, '0')}-BLK`,
    }));

    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: references.length,
        },
      ],
      references,
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

    mockFetchProductDataReference.mockImplementation(async ({ reference }) => ({
      status: 200,
      products: [
        {
          sku: reference.productId,
          vendor_product_id: reference.productId,
          name: reference.productId,
          cost_price: 10,
        },
      ],
    }));

    mockBuildProductAssembly.mockImplementation(async ({ baseProducts }) => ({
      endpointResults: [],
      products: baseProducts.map((product: any) => ({
        ...product,
        enrichment_status: {
          pricing: 'SUCCESS',
          inventory: 'SUCCESS',
          media: 'SUCCESS',
          gating_reasons: [],
        },
      })),
      statuses: baseProducts.map((product: any) => ({
        sku: product.sku,
        vendor_product_id: product.vendor_product_id,
        blocked: false,
        gating_reasons: [],
        enrichment_status: {
          pricing: 'SUCCESS',
          inventory: 'SUCCESS',
          media: 'SUCCESS',
          gating_reasons: [],
        },
      })),
      mediaRetries: [],
    }));

    const result = await runVendorSync({
      vendorId: 7,
      session: {
        accessToken: 'token',
        storeHash: 'storehash',
        user: { id: 1, email: 'test@example.com' },
      },
      syncAll: true,
      integrationJobId: 91,
      sourceAction: 'manual_sync',
      correlationId: 'corr-91',
    });

    expect(mockFetchProductDataReference).toHaveBeenCalledTimes(15);
    expect(mockFetchProductDataReference).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reference: expect.objectContaining({ productId: 'PROD-15' }),
      }),
    );
    expect(result.continuation).toEqual({
      enqueued: false,
      nextStartReferenceIndex: 15,
      totalReferences: 16,
      maxReferencesPerRun: 15,
      initialLastSuccessfulSyncAt: null,
      sourceAction: 'manual_sync',
      correlationId: 'corr-91',
    });
  });

  test('keeps full-sync continuations on ProductSellable discovery instead of falling back to incremental discovery', async () => {
    mockListSyncRunsForVendor.mockResolvedValue([
      {
        etl_sync_run_id: 10,
        status: 'SUCCESS',
        started_at: '2026-03-31T00:00:00.000Z',
        ended_at: '2026-03-31T01:00:00.000Z',
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
      integrationJobId: 92,
      sourceAction: 'manual_sync',
      correlationId: 'corr-92',
      continuation: {
        start_reference_index: 15,
        max_references_per_run: 15,
        initial_last_successful_sync_at: null,
      },
    });

    expect(mockDiscoverProductDataReferences).toHaveBeenCalledWith(
      expect.objectContaining({
        lastSuccessfulSyncAt: null,
      }),
    );
  });

  test('does not crash when ProductData discovery returns no references and no getProduct config', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductDateModified',
          status: 200,
          products_found: 0,
        },
      ],
      references: [],
      getProductConfig: null,
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
        integrationJobId: 93,
        sourceAction: 'manual_sync',
        correlationId: 'corr-93',
        continuation: {
          start_reference_index: 15,
          max_references_per_run: 15,
          initial_last_successful_sync_at: null,
        },
      }),
    ).resolves.toMatchObject({
      recordsRead: 0,
      recordsWritten: 0,
    });
  });

  test('fails early when the first two products are blocked before any BigCommerce write', async () => {
    mockDiscoverProductDataReferences.mockResolvedValue({
      endpointResults: [
        {
          mapping_id: 100,
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          status: 200,
          products_found: 3,
        },
      ],
      references: Array.from({ length: 5 }, (_, index) => ({
        productId: `BLOCK-${index + 1}`,
        partId: `BLOCK-${index + 1}-BLK`,
      })),
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

    mockFetchProductDataReference
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'BLOCK-1', vendor_product_id: 'BLOCK-1', name: 'Blocked One' }],
      })
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'BLOCK-2', vendor_product_id: 'BLOCK-2', name: 'Blocked Two' }],
      })
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'BLOCK-3', vendor_product_id: 'BLOCK-3', name: 'Blocked Three' }],
      })
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'BLOCK-4', vendor_product_id: 'BLOCK-4', name: 'Blocked Four' }],
      })
      .mockResolvedValueOnce({
        status: 200,
        products: [{ sku: 'BLOCK-5', vendor_product_id: 'BLOCK-5', name: 'Blocked Five' }],
      });

    mockBuildProductAssembly
      .mockResolvedValueOnce({
        endpointResults: [],
        products: [],
        statuses: [
          {
            sku: 'BLOCK-1',
            vendor_product_id: 'BLOCK-1',
            blocked: true,
            gating_reasons: ['No pricing data available for product.'],
            enrichment_status: {
              pricing: 'FAILED',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: ['No pricing data available for product.'],
            },
          },
        ],
        mediaRetries: [],
      })
      .mockResolvedValueOnce({
        endpointResults: [],
        products: [],
        statuses: [
          {
            sku: 'BLOCK-2',
            vendor_product_id: 'BLOCK-2',
            blocked: true,
            gating_reasons: ['No pricing data available for product.'],
            enrichment_status: {
              pricing: 'FAILED',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: ['No pricing data available for product.'],
            },
          },
        ],
        mediaRetries: [],
      })
      .mockResolvedValueOnce({
        endpointResults: [],
        products: [],
        statuses: [
          {
            sku: 'BLOCK-3',
            vendor_product_id: 'BLOCK-3',
            blocked: true,
            gating_reasons: ['No pricing data available for product.'],
            enrichment_status: {
              pricing: 'FAILED',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: ['No pricing data available for product.'],
            },
          },
        ],
        mediaRetries: [],
      })
      .mockResolvedValueOnce({
        endpointResults: [],
        products: [],
        statuses: [
          {
            sku: 'BLOCK-4',
            vendor_product_id: 'BLOCK-4',
            blocked: true,
            gating_reasons: ['No pricing data available for product.'],
            enrichment_status: {
              pricing: 'FAILED',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: ['No pricing data available for product.'],
            },
          },
        ],
        mediaRetries: [],
      })
      .mockResolvedValueOnce({
        endpointResults: [],
        products: [],
        statuses: [
          {
            sku: 'BLOCK-5',
            vendor_product_id: 'BLOCK-5',
            blocked: true,
            gating_reasons: ['No pricing data available for product.'],
            enrichment_status: {
              pricing: 'FAILED',
              inventory: 'SUCCESS',
              media: 'SUCCESS',
              gating_reasons: ['No pricing data available for product.'],
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
    ).rejects.toThrow('Vendor sync halted during early product validation');

    expect(mockFetchProductDataReference).toHaveBeenCalledTimes(5);
    expect(mockUpsertBigCommerceProduct).not.toHaveBeenCalled();
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        etl_sync_run_id: 11,
        status: 'FAILED',
        error_message: expect.stringContaining('0 of first 5 products passed enrichment'),
      }),
    );
  });

  test('fails when blocked products reach 50 percent after 100 attempted products', async () => {
    const blockedStatuses = Array.from({ length: 99 }, (_, index) => ({
      sku: `BLOCK-${index + 1}`,
      vendor_product_id: `BLOCK-${index + 1}`,
      blocked: true as const,
      gating_reasons: ['No pricing data available for product.'],
      enrichment_status: {
        pricing: 'FAILED',
        inventory: 'SUCCESS',
        media: 'SUCCESS',
        gating_reasons: ['No pricing data available for product.'],
      },
    }));

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
      references: [{ productId: 'BULK-SET', partId: 'BULK-SET-1' }],
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
        { sku: 'PASS-1', vendor_product_id: 'PASS-1', name: 'Passing Product', cost_price: 10 },
        ...blockedStatuses.map(status => ({
          sku: status.sku,
          vendor_product_id: status.vendor_product_id,
          name: status.sku,
        })),
      ],
    });

    mockBuildProductAssembly.mockResolvedValue({
      endpointResults: [],
      products: [
        {
          sku: 'PASS-1',
          vendor_product_id: 'PASS-1',
          name: 'Passing Product',
          cost_price: 10,
          enrichment_status: {
            pricing: 'SUCCESS',
            inventory: 'SUCCESS',
            media: 'SUCCESS',
            gating_reasons: [],
          },
        },
      ],
      statuses: [
        {
          sku: 'PASS-1',
          vendor_product_id: 'PASS-1',
          blocked: false,
          gating_reasons: [],
          enrichment_status: {
            pricing: 'SUCCESS',
            inventory: 'SUCCESS',
            media: 'SUCCESS',
            gating_reasons: [],
          },
        },
        ...blockedStatuses,
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
    ).rejects.toThrow('exceeding the 50% threshold');

    expect(mockUpsertBigCommerceProduct).not.toHaveBeenCalled();
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        etl_sync_run_id: 11,
        status: 'FAILED',
        error_message: expect.stringContaining('99 products (99%) failed enrichment'),
      }),
    );
  });

  test('persists vendor product map and records written when BigCommerce product exists before a later sync failure', async () => {
    const error = new Error('Failed to update product modifier (422): duplicate label');
    Object.assign(error, {
      partial_upsert_result: {
        product: { id: 999, sku: 'SKU-1', name: 'Example' },
        duplicate: false,
        action: 'update',
        resolvedSku: 'SKU-1',
        markupPercent: 30,
      },
    });
    mockUpsertBigCommerceProduct.mockRejectedValueOnce(error);

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
    ).rejects.toThrow('Failed to update product modifier');

    expect(mockUpsertVendorProductMap).toHaveBeenCalledWith(
      expect.objectContaining({
        vendor_id: 7,
        bigcommerce_product_id: 999,
        sku: 'SKU-1',
        metadata: expect.objectContaining({
          partial_failure: true,
        }),
      }),
    );
    expect(mockCompleteSyncRun).toHaveBeenCalledWith(
      expect.objectContaining({
        etl_sync_run_id: 11,
        status: 'FAILED',
        details: expect.objectContaining({
          recordsWritten: 1,
        }),
      }),
    );
    expect(mockLoggerError).toHaveBeenCalledWith(
      'vendor sync failed',
      expect.objectContaining({
        recordsWritten: 1,
      }),
    );
  });
});
