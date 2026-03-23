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
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operationName: 'getConfigurationAndPricing',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            currency: 'USD',
            productId: 'P-1',
          }),
        }),
      }),
    );
  });

  test('blocks product when no pricing mappings are assigned and no product price is available', async () => {
    mockInvokeEndpoint.mockResolvedValueOnce({
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
          variants: [
            {
              sku: 'SKU-1-BLK',
              part_id: 'SKU-1-BLK',
              option_values: [{ option_display_name: 'Color', label: 'Black' }],
            },
            {
              sku: 'SKU-1-BLU',
              part_id: 'SKU-1-BLU',
              option_values: [{ option_display_name: 'Color', label: 'Blue' }],
            },
          ],
        },
      ],
    });

    expect(result.products).toHaveLength(0);
    expect(result.statuses[0].blocked).toBe(true);
    expect(result.statuses[0].gating_reasons).toEqual(
      expect.arrayContaining(['No pricing data available for product.']),
    );
    expect(result.statuses[0].enrichment_status.pricing).toBe('FAILED');
  });

  test('supplies required derived fields to PricingAndConfiguration operations', async () => {
    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          GetAvailableLocationsResponse: {
            AvailableLocationArray: {
              AvailableLocation: [
                {
                  locationId: 'LOC-1',
                  locationName: 'Front',
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          GetDecorationColorsResponse: {
            color: 'Black',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          GetFobPointsResponse: {
            FobPointArray: {
              FobPoint: [
                {
                  fobId: 'FOB-1',
                  fobCity: 'Montreal',
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          GetAvailableChargesResponse: {
            AvailableChargeArray: {
              AvailableCharge: [],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<ok/>',
        parsedBody: {
          Configuration: {
            productId: 'P-1',
            currency: 'USD',
            priceType: 'List',
            PartArray: {
              Part: [
                {
                  partId: 'SKU-1',
                  PartPriceArray: {
                    PartPrice: [
                      {
                        minQuantity: 1,
                        price: 12.5,
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      });

    const assignedMappings = [
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
          endpoint_name: 'PricingAndConfiguration',
          endpoint_version: '1.0.0',
          operation_name: 'getAvailableCharges',
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
          endpoint_name: 'PricingAndConfiguration',
          endpoint_version: '1.0.0',
          operation_name: 'getDecorationColors',
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
        vendor_endpoint_mapping_id: 4,
        vendor_id: 22,
        mapping_id: 114,
        is_enabled: true,
        runtime_config: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        mapping: {
          mapping_id: 114,
          standard_type: 'PROMOSTANDARDS',
          endpoint_name: 'PricingAndConfiguration',
          endpoint_version: '1.0.0',
          operation_name: 'getFobPoints',
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
        vendor_endpoint_mapping_id: 5,
        vendor_id: 22,
        mapping_id: 115,
        is_enabled: true,
        runtime_config: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        mapping: {
          mapping_id: 115,
          standard_type: 'PROMOSTANDARDS',
          endpoint_name: 'PricingAndConfiguration',
          endpoint_version: '1.0.0',
          operation_name: 'getAvailableLocations',
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
    ] as any;

    const result = await buildProductAssembly({
      vendor: vendor as any,
      assignedMappings,
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
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(5);
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        operationName: 'getAvailableLocations',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            currency: 'USD',
            productId: 'P-1',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operationName: 'getDecorationColors',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            currency: 'USD',
            locationId: 'LOC-1',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        operationName: 'getAvailableCharges',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            currency: 'USD',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        operationName: 'getConfigurationAndPricing',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            currency: 'USD',
            fobId: 'FOB-1',
            priceType: 'List',
            configurationType: 'Blank',
          }),
        }),
      }),
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
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(3);
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

  test('applies part-level inventory quantities to matching variants', async () => {
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
          InventoryArray: {
            Inventory: [
              {
                partId: 'SKU-1-BLK',
                quantityAvailable: 12,
              },
              {
                partId: 'SKU-1-BLU',
                quantityAvailable: 7,
              },
            ],
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
          variants: [
            {
              sku: 'SKU-1-BLK',
              source_sku: 'SKU-1-BLK',
              part_id: 'SKU-1-BLK',
              option_values: [{ option_display_name: 'Color', label: 'Black' }],
            },
            {
              sku: 'SKU-1-BLU',
              source_sku: 'SKU-1-BLU',
              part_id: 'SKU-1-BLU',
              option_values: [{ option_display_name: 'Color', label: 'Blue' }],
            },
          ],
        },
      ],
    });

    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operationName: 'getInventoryLevels',
        runtimeConfig: expect.objectContaining({
          request_fields: expect.objectContaining({
            productId: 'P-1',
            localizationCountry: 'US',
            localizationLanguage: 'en',
          }),
        }),
      }),
    );
    expect(mockInvokeEndpoint.mock.calls[1]?.[0]?.runtimeConfig?.request_fields?.partId).toBeUndefined();
    expect(result.products).toHaveLength(1);
    expect(result.products[0].inventory_level).toBe(19);
    expect(result.products[0].variants).toEqual([
      expect.objectContaining({
        sku: 'SKU-1-BLK',
        inventory_level: 12,
      }),
      expect.objectContaining({
        sku: 'SKU-1-BLU',
        inventory_level: 7,
      }),
    ]);
  });

  test('calls getMediaContent for image media type', async () => {
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
      ;

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
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(3);
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
                  Location: [{ locationId: 'LOC-FRONT', locationName: 'Front Pocket', locationRank: 1 }],
                },
                DecorationArray: {
                  Decoration: [{ decorationId: 'DEC-SCREEN', decorationName: 'Screen Print' }],
                },
              },
            ],
          },
        },
      })
      ;

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
        location_names: ['Front Pocket'],
        decoration_ids: ['DEC-SCREEN'],
        decoration_names: ['Screen Print'],
        description: 'Black front',
        class_types: ['Primary', 'Decorated'],
        color: 'Black',
        single_part: true,
        change_timestamp: '2026-03-22T12:01:00',
        width: 1200,
        height: 1200,
        dpi: 300,
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
