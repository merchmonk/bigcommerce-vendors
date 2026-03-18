import { buildProductAssembly } from '@lib/etl/productEnrichment';

const mockInvokeEndpoint = jest.fn();

jest.mock('@lib/etl/adapters/factory', () => ({
  resolveEndpointAdapter: () => ({
    protocol: 'SOAP',
    testConnection: jest.fn(),
    invokeEndpoint: (...args: unknown[]) => mockInvokeEndpoint(...args),
  }),
}));

const vendor = {
  vendor_id: 22,
  vendor_name: 'Vendor',
  vendor_api_url: 'https://vendor.example.com',
  vendor_account_id: 'acct',
  vendor_secret: 'secret',
  integration_family: 'PROMOSTANDARDS',
  api_protocol: 'SOAP',
  connection_config: {},
  is_active: true,
  datetime_added: new Date().toISOString(),
  datetime_modified: new Date().toISOString(),
} as const;

describe('buildProductAssembly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('blocks product when mapped pricing call fails', async () => {
    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 500,
        rawPayload: '<error/>',
        parsedBody: null,
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          inventoryResponse: {
            quantityAvailable: 42,
          },
        },
      });

    const result = await buildProductAssembly({
      vendor: vendor as any,
      assignedMappings: [
        {
          vendor_endpoint_mapping_id: 1,
          vendor_id: 22,
          mapping_id: 111,
          is_enabled: true,
          runtime_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 111,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'PricingAndConfiguration',
            endpoint_version: '1.0.0',
            operation_name: 'getConfigurationAndPricing',
            protocol: 'SOAP',
            payload_format: 'XML',
            is_product_endpoint: true,
            structure_json: {},
            structure_xml: null,
            request_schema: {},
            response_schema: {},
            transform_schema: {},
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        {
          vendor_endpoint_mapping_id: 2,
          vendor_id: 22,
          mapping_id: 112,
          is_enabled: true,
          runtime_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 112,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'Inventory',
            endpoint_version: '1.2.1',
            operation_name: 'getInventoryLevels',
            protocol: 'SOAP',
            payload_format: 'XML',
            is_product_endpoint: true,
            structure_json: {},
            structure_xml: null,
            request_schema: {},
            response_schema: {},
            transform_schema: {},
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      ] as any,
      baseProducts: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'P-1',
          name: 'Product',
          cost_price: 10,
        },
      ],
    });

    expect(result.products).toHaveLength(0);
    expect(result.statuses[0].blocked).toBe(true);
    expect(result.statuses[0].gating_reasons).toEqual(
      expect.arrayContaining(['PricingAndConfiguration enrichment failed.']),
    );
  });

  test('allows write when media fails and records retry marker', async () => {
    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          pricing: {
            price: 9.5,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          inventoryResponse: {
            quantityAvailable: 12,
          },
        },
      })
      .mockResolvedValueOnce({
        status: 500,
        rawPayload: '<error/>',
        parsedBody: null,
      });

    const result = await buildProductAssembly({
      vendor: vendor as any,
      assignedMappings: [
        {
          vendor_endpoint_mapping_id: 1,
          vendor_id: 22,
          mapping_id: 111,
          is_enabled: true,
          runtime_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 111,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'PricingAndConfiguration',
            endpoint_version: '1.0.0',
            operation_name: 'getConfigurationAndPricing',
            protocol: 'SOAP',
            payload_format: 'XML',
            is_product_endpoint: true,
            structure_json: {},
            structure_xml: null,
            request_schema: {},
            response_schema: {},
            transform_schema: {},
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        {
          vendor_endpoint_mapping_id: 2,
          vendor_id: 22,
          mapping_id: 112,
          is_enabled: true,
          runtime_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 112,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'Inventory',
            endpoint_version: '1.2.1',
            operation_name: 'getInventoryLevels',
            protocol: 'SOAP',
            payload_format: 'XML',
            is_product_endpoint: true,
            structure_json: {},
            structure_xml: null,
            request_schema: {},
            response_schema: {},
            transform_schema: {},
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
        {
          vendor_endpoint_mapping_id: 3,
          vendor_id: 22,
          mapping_id: 113,
          is_enabled: true,
          runtime_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 113,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'ProductMedia',
            endpoint_version: '1.0.0',
            operation_name: 'getMediaContent',
            protocol: 'SOAP',
            payload_format: 'XML',
            is_product_endpoint: true,
            structure_json: {},
            structure_xml: null,
            request_schema: {},
            response_schema: {},
            transform_schema: {},
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      ] as any,
      baseProducts: [
        {
          sku: 'SKU-1',
          vendor_product_id: 'P-1',
          name: 'Product',
          cost_price: 10,
        },
      ],
    });

    expect(result.products).toHaveLength(1);
    expect(result.statuses[0].blocked).toBe(false);
    expect(result.statuses[0].enrichment_status.media).toBe('FAILED');
    expect(result.mediaRetries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vendor_product_id: 'P-1',
        }),
      ]),
    );
  });
});
