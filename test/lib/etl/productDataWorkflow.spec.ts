import { runProductDataWorkflow } from '@lib/etl/productDataWorkflow';

const mockInvokeEndpoint = jest.fn();

jest.mock('@lib/etl/adapters/factory', () => ({
  resolveEndpointAdapter: () => ({
    protocol: 'SOAP',
    testConnection: jest.fn(),
    invokeEndpoint: (...args: unknown[]) => mockInvokeEndpoint(...args),
  }),
}));

describe('runProductDataWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses getProductSellable to discover IDs, then calls getProduct with productId/partId', async () => {
    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<xml/>',
        parsedBody: {
          getProductSellableResponse: {
            ProductSellableArray: {
              ProductSellable: [{ productId: 'P-1', partId: 'P-1-RED' }],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<xml/>',
        parsedBody: {
          getProductResponse: {
            Product: {
              productId: 'P-1',
              productName: 'Test Product',
              ProductPartArray: {
                ProductPart: [{ partId: 'P-1-RED' }],
              },
            },
          },
        },
      });

    const result = await runProductDataWorkflow({
      vendor: {
        vendor_id: 10,
        vendor_name: 'Vendor',
        vendor_api_url: 'https://vendor.example.com/productdata',
        vendor_account_id: 'acct',
        vendor_secret: 'secret',
        integration_family: 'PROMOSTANDARDS',
        api_protocol: 'SOAP',
        connection_config: {},
        is_active: true,
        datetime_added: new Date().toISOString(),
        datetime_modified: new Date().toISOString(),
      },
      assignedMappings: [
        {
          vendor_endpoint_mapping_id: 1,
          vendor_id: 10,
          mapping_id: 100,
          is_enabled: true,
          runtime_config: {
            localization_country: 'US',
            localization_language: 'en',
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 100,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'ProductData',
            endpoint_version: '2.0.0',
            operation_name: 'getProductSellable',
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
          vendor_id: 10,
          mapping_id: 101,
          is_enabled: true,
          runtime_config: {
            localization_country: 'US',
            localization_language: 'en',
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          mapping: {
            mapping_id: 101,
            standard_type: 'PROMOSTANDARDS',
            endpoint_name: 'ProductData',
            endpoint_version: '2.0.0',
            operation_name: 'getProduct',
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
      ],
    });

    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(2);
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operationName: 'getProductSellable',
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operationName: 'getProduct',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            productId: 'P-1',
            partId: 'P-1-RED',
          }),
        }),
      }),
    );
    expect(result.products).toHaveLength(1);
    expect(result.products[0].vendor_product_id).toBe('P-1');
  });
});
