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
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(4);
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        operationName: 'getMediaContent',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            mediaType: 'Image',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        operationName: 'getMediaContent',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            mediaType: 'Video',
          }),
        }),
      }),
    );
    expect(result.mediaRetries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vendor_product_id: 'P-1',
        }),
      ]),
    );
  });

  test('ignores ProductMedia mappings that are not getMediaContent', async () => {
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
            endpoint_version: '1.1.0',
            operation_name: 'getMediaDateModified',
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

    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(2);
    expect(result.products).toHaveLength(1);
    expect(result.statuses[0].blocked).toBe(false);
    expect(result.statuses[0].enrichment_status.media).toBe('MISSING');
    expect(result.mediaRetries).toHaveLength(0);
  });

  test('calls getMediaContent for both Image and Video media types', async () => {
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
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          mediaContentResponse: {
            mediaUrl: 'https://cdn.example.com/image.jpg',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          mediaContentResponse: {
            mediaUrl: 'https://cdn.example.com/video.mp4',
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
            endpoint_version: '1.1.0',
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
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(4);
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        operationName: 'getMediaContent',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            mediaType: 'Image',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        operationName: 'getMediaContent',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            mediaType: 'Video',
          }),
        }),
      }),
    );
  });

  test('parses structured media assets from ProductMedia payloads', async () => {
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
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          MediaContentArray: {
            MediaContent: [
              {
                url: 'https://cdn.example.com/product.jpg',
                mediaType: 'Image',
                description: 'Hero image',
                singlePart: false,
                partId: '',
                changeTimeStamp: '2026-03-22T12:00:00',
                ClassTypeArray: {
                  ClassType: ['Primary'],
                },
              },
              {
                url: 'https://cdn.example.com/part-black.jpg',
                mediaType: 'Image',
                description: 'Black front',
                singlePart: true,
                partId: 'PART-BLK',
                color: 'Black',
                height: 1200,
                width: 1200,
                dpi: 300,
                changeTimeStamp: '2026-03-22T12:01:00',
                ClassTypeArray: {
                  ClassType: ['Primary', 'Decorated'],
                },
                LocationArray: {
                  Location: [{ locationId: 'LOC-FRONT' }],
                },
                DecorationArray: {
                  Decoration: [{ decorationId: 'DEC-SCREEN' }],
                },
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          MediaContentArray: {
            MediaContent: {
              url: 'https://cdn.example.com/demo.mp4',
              mediaType: 'Video',
              description: 'Demo video',
              partId: 'PART-BLK',
              singlePart: true,
            },
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
            endpoint_version: '1.1.0',
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
          variants: [
            {
              sku: 'SKU-1-BLK',
              part_id: 'PART-BLK',
              option_values: [],
            },
          ],
        },
      ],
    });

    expect(result.products[0].media_assets).toEqual([
      {
        url: 'https://cdn.example.com/product.jpg',
        media_type: 'Image',
        description: 'Hero image',
        class_types: ['Primary'],
        single_part: false,
        change_timestamp: '2026-03-22T12:00:00',
      },
      {
        url: 'https://cdn.example.com/part-black.jpg',
        media_type: 'Image',
        part_id: 'PART-BLK',
        location_ids: ['LOC-FRONT'],
        decoration_ids: ['DEC-SCREEN'],
        description: 'Black front',
        class_types: ['Primary', 'Decorated'],
        color: 'Black',
        single_part: true,
        change_timestamp: '2026-03-22T12:01:00',
        width: 1200,
        height: 1200,
        dpi: 300,
      },
      {
        url: 'https://cdn.example.com/demo.mp4',
        media_type: 'Video',
        part_id: 'PART-BLK',
        description: 'Demo video',
        single_part: true,
      },
    ]);
    expect(result.products[0].images).toEqual([
      {
        image_url: 'https://cdn.example.com/product.jpg',
        is_thumbnail: true,
      },
      {
        image_url: 'https://cdn.example.com/part-black.jpg',
      },
    ]);
  });

  test('falls back to part-scoped media calls when product-level media has no part associations', async () => {
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
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          MediaContentArray: {
            MediaContent: {
              url: 'https://cdn.example.com/product.jpg',
              mediaType: 'Image',
              singlePart: false,
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          MediaContentArray: {
            MediaContent: {
              url: 'https://cdn.example.com/part-black.jpg',
              mediaType: 'Image',
              singlePart: true,
              partId: 'PART-BLK',
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          MediaContentArray: {
            MediaContent: {
              url: 'https://cdn.example.com/part-red.jpg',
              mediaType: 'Image',
              singlePart: true,
              partId: 'PART-RED',
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          errorMessage: {
            code: 160,
            description: 'No Result Found',
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
            endpoint_version: '1.1.0',
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
          variants: [
            {
              sku: 'SKU-1-BLK',
              part_id: 'PART-BLK',
              option_values: [],
            },
            {
              sku: 'SKU-1-RED',
              part_id: 'PART-RED',
              option_values: [],
            },
          ],
        },
      ],
    });

    expect(mockInvokeEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: 'getMediaContent',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            mediaType: 'Image',
            partId: 'PART-BLK',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: 'getMediaContent',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            mediaType: 'Image',
            partId: 'PART-RED',
          }),
        }),
      }),
    );
    expect(result.products[0].media_assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://cdn.example.com/part-black.jpg', part_id: 'PART-BLK' }),
        expect.objectContaining({ url: 'https://cdn.example.com/part-red.jpg', part_id: 'PART-RED' }),
      ]),
    );
  });
});
