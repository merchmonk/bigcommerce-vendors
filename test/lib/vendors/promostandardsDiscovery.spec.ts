import {
  buildPromostandardsConnectionFingerprint,
  discoverPromostandardsCapabilities,
  discoverPromostandardsEndpointsFromCompanyData,
  probePromostandardsEndpoint,
  resolvePromostandardsCapabilityMappings,
  testPromostandardsEndpointUrls,
} from '@lib/vendors/promostandardsDiscovery';

const mockListEndpointMappings = jest.fn();
const mockResolveEndpointAdapter = jest.fn();
const mockInvokeEndpoint = jest.fn();
const mockFetch = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  listEndpointMappings: (...args: unknown[]) => mockListEndpointMappings(...args),
}));

jest.mock('@lib/etl/adapters/factory', () => ({
  resolveEndpointAdapter: (...args: unknown[]) => mockResolveEndpointAdapter(...args),
}));

describe('promostandardsDiscovery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveEndpointAdapter.mockReturnValue({
      invokeEndpoint: mockInvokeEndpoint,
    });
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  test('builds a stable fingerprint without storing raw credentials', () => {
    const first = buildPromostandardsConnectionFingerprint({
      vendor_api_url: 'https://example.com/soap',
      vendor_account_id: 'acct-1',
      vendor_secret: 'top-secret',
      api_protocol: 'SOAP',
    });
    const second = buildPromostandardsConnectionFingerprint({
      vendor_api_url: 'https://example.com/soap',
      vendor_account_id: 'acct-1',
      vendor_secret: 'top-secret',
      api_protocol: 'SOAP',
    });
    const changed = buildPromostandardsConnectionFingerprint({
      vendor_api_url: 'https://example.com/soap',
      vendor_account_id: 'acct-1',
      vendor_secret: 'different-secret',
      api_protocol: 'SOAP',
    });

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
    expect(first).not.toContain('top-secret');
  });

  test('discovers endpoint availability from PromoStandards mappings', async () => {
    mockListEndpointMappings.mockResolvedValue([
      {
        mapping_id: 1,
        endpoint_name: 'CompanyData',
        endpoint_version: '1.0.0',
        operation_name: 'getCompanyData',
        protocol: 'SOAP',
      },
      {
        mapping_id: 2,
        endpoint_name: 'ProductData',
        endpoint_version: '2.0.0',
        operation_name: 'getProduct',
        protocol: 'SOAP',
      },
      {
        mapping_id: 3,
        endpoint_name: 'ProductData',
        endpoint_version: '2.0.0',
        operation_name: 'getProductSellable',
        protocol: 'SOAP',
      },
      {
        mapping_id: 4,
        endpoint_name: 'Inventory',
        endpoint_version: '1.2.1',
        operation_name: 'getInventoryLevels',
        protocol: 'SOAP',
      },
    ]);

    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<Envelope><Body><getCompanyDataResponse /></Body></Envelope>',
        parsedBody: { getCompanyDataResponse: {} },
      })
      .mockResolvedValueOnce({
        status: 500,
        rawPayload: '<Envelope><Body><Fault><faultstring>partId is required</faultstring></Fault></Body></Envelope>',
        parsedBody: { Fault: { faultstring: 'partId is required' } },
      })
      .mockResolvedValueOnce({
        status: 500,
        rawPayload:
          '<Envelope><Body><Fault><faultstring>Server did not recognize the value of HTTP Header SOAPAction</faultstring></Fault></Body></Envelope>',
        parsedBody: {
          Fault: {
            faultstring: 'Server did not recognize the value of HTTP Header SOAPAction',
          },
        },
      })
      .mockRejectedValueOnce(new Error('Endpoint probe failed'));

    const result = await discoverPromostandardsCapabilities({
      vendor_api_url: 'https://example.com/soap',
      vendor_account_id: 'acct-1',
      vendor_secret: 'secret',
      api_protocol: 'SOAP',
    });

    expect(result.ok).toBe(true);
    expect(result.availableEndpointCount).toBe(2);
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpointName: 'CompanyData',
          endpointVersion: '1.0.0',
          available: true,
        }),
        expect.objectContaining({
          endpointName: 'Inventory',
          endpointVersion: '1.2.1',
          available: true,
        }),
        expect.objectContaining({
          endpointName: 'ProductData',
          endpointVersion: '2.0.0',
          available: false,
        }),
      ]),
    );
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(4);
  });

  test('treats request-field SOAP faults as credential-valid probe responses', async () => {
    mockListEndpointMappings.mockResolvedValue([
      {
        mapping_id: 1,
        endpoint_name: 'ProductData',
        endpoint_version: '2.0.0',
        operation_name: 'getProductSellable',
        protocol: 'SOAP',
      },
    ]);

    mockInvokeEndpoint.mockResolvedValueOnce({
      status: 500,
      rawPayload:
        '<Envelope><Body><Fault><faultstring>WsVersion not found.</faultstring></Fault></Body></Envelope>',
      parsedBody: { Fault: { faultstring: 'WsVersion not found.' } },
    });

    const result = await discoverPromostandardsCapabilities({
      vendor_api_url: 'https://example.com/soap',
      vendor_account_id: 'acct-1',
      vendor_secret: 'secret',
      api_protocol: 'SOAP',
    });

    expect(result.credentialsValid).toBe(true);
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpointName: 'ProductData',
          endpointVersion: '2.0.0',
          credentials_valid: true,
          live_probe_message: 'WsVersion not found.',
        }),
      ]),
    );
  });

  test('captures resolved endpoint URLs from CompanyData service details and uses them for later probes', async () => {
    mockListEndpointMappings.mockResolvedValue([
      {
        mapping_id: 1,
        endpoint_name: 'CompanyData',
        endpoint_version: '1.0.0',
        operation_name: 'getCompanyData',
        protocol: 'SOAP',
      },
      {
        mapping_id: 2,
        endpoint_name: 'PricingAndConfiguration',
        endpoint_version: '1.0.0',
        operation_name: 'getConfigurationAndPricing',
        protocol: 'SOAP',
      },
    ]);

    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<Envelope><Body><getCompanyDataResponse /></Body></Envelope>',
        parsedBody: {
          getCompanyDataResponse: {
            PromoStandardsServiceDetailArray: {
              PromoStandardsServiceDetail: {
                serviceName: 'PPC',
                serviceVersion: '1.0.0',
                url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap?wsdl',
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<Envelope><Body><getConfigurationAndPricingResponse /></Body></Envelope>',
        parsedBody: { getConfigurationAndPricingResponse: {} },
      });

    const result = await discoverPromostandardsCapabilities({
      vendor_api_url: 'https://vendor.example.com',
      vendor_account_id: 'acct-1',
      vendor_secret: 'secret',
      api_protocol: 'SOAP',
    });

    expect(mockInvokeEndpoint).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        endpointUrl: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
      }),
    );
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpointName: 'PricingAndConfiguration',
          endpointUrl: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
        }),
      ]),
    );
  });

  test('treats explicit endpoint URLs as final when probing a PromoStandards endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">
          <wsdl:portType>
            <wsdl:operation name="getProductSellable"></wsdl:operation>
          </wsdl:portType>
        </wsdl:definitions>
      `,
    });
    mockInvokeEndpoint.mockResolvedValue({
      status: 200,
      rawPayload: '<Envelope><Body><GetProductSellableResponse /></Body></Envelope>',
      parsedBody: { GetProductSellableResponse: {} },
    });

    await probePromostandardsEndpoint({
      endpointUrl: 'https://wsp.gemline.com/GemlineWebService/ProductData/v2/GemlineProductDataService.svc',
      endpointUrlIsFinal: true,
      endpointName: 'ProductData',
      endpointVersion: '2.0.0',
      operationName: 'getProductSellable',
      vendorAccountId: 'acct-1',
      vendorSecret: 'secret-1',
      protocol: 'SOAP',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://wsp.gemline.com/GemlineWebService/ProductData/v2/GemlineProductDataService.svc?wsdl',
      expect.any(Object),
    );
    expect(mockInvokeEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointUrl: 'https://wsp.gemline.com/GemlineWebService/ProductData/v2/GemlineProductDataService.svc',
        runtimeConfig: {
          endpoint_url: 'https://wsp.gemline.com/GemlineWebService/ProductData/v2/GemlineProductDataService.svc',
        },
      }),
    );
  });

  test('resolves mapping ids from available endpoint versions', async () => {
    mockListEndpointMappings.mockResolvedValue([{ mapping_id: 11 }, { mapping_id: 12 }, { mapping_id: 13 }]);

    const mappingIds = await resolvePromostandardsCapabilityMappings({
      endpoints: [
        {
          endpointName: 'CompanyData',
          endpointVersion: '1.0.0',
          endpointUrl: 'https://vendor.example.com/companydata',
          available: true,
          status_code: 200,
          message: 'ok',
        },
        {
          endpointName: 'Inventory',
          endpointVersion: '1.2.1',
          endpointUrl: 'https://vendor.example.com/inventory',
          available: false,
          status_code: 500,
          message: 'unsupported',
        },
      ],
    });

    expect(mockListEndpointMappings).toHaveBeenCalledWith({
      standard_type: 'PROMOSTANDARDS',
      endpoint_name: 'CompanyData',
      endpoint_version: '1.0.0',
    });
    expect(mappingIds).toEqual([11, 12, 13]);
  });

  test('tests manual endpoint URLs by detecting the version from the URL before WSDL inspection', async () => {
    mockListEndpointMappings.mockResolvedValue([
      {
        mapping_id: 31,
        endpoint_name: 'Inventory',
        endpoint_version: '2.0.0',
        operation_name: 'getInventoryLevels',
        protocol: 'SOAP',
      },
    ]);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => `
        <wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">
          <wsdl:portType>
            <wsdl:operation name="getInventoryLevels"></wsdl:operation>
          </wsdl:portType>
        </wsdl:definitions>
      `,
    });
    mockInvokeEndpoint.mockResolvedValue({
      status: 200,
      rawPayload: '<Envelope><Body><getInventoryLevelsResponse /></Body></Envelope>',
      parsedBody: { getInventoryLevelsResponse: {} },
    });

    const result = await testPromostandardsEndpointUrls({
      vendorAccountId: 'acct-1',
      vendorSecret: 'secret-1',
      protocol: 'SOAP',
      endpoints: [
        {
          endpointName: 'Inventory',
          endpointUrl: 'https://wsp.gemline.com/GemlineWebService/Inventory/v2/GemlineInventoryService.svc',
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.availableEndpointCount).toBe(1);
    expect(result.endpoints).toEqual([
      expect.objectContaining({
        endpointName: 'Inventory',
        endpointVersion: '2.0.0',
        endpointUrl: 'https://wsp.gemline.com/GemlineWebService/Inventory/v2/GemlineInventoryService.svc',
        versionDetectionStatus: 'detected_from_url',
        requiresManualVersionSelection: false,
      }),
    ]);
    expect(result.endpointMappingIds).toEqual([31]);
  });

  test('requires manual version selection when version detection fails', async () => {
    mockListEndpointMappings.mockResolvedValue([
      {
        mapping_id: 41,
        endpoint_name: 'ProductData',
        endpoint_version: '1.0.0',
        operation_name: 'getProduct',
        protocol: 'SOAP',
      },
      {
        mapping_id: 42,
        endpoint_name: 'ProductData',
        endpoint_version: '2.0.0',
        operation_name: 'getProduct',
        protocol: 'SOAP',
      },
    ]);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '',
    });

    const result = await testPromostandardsEndpointUrls({
      endpoints: [
        {
          endpointName: 'ProductData',
          endpointUrl: 'https://vendor.example.com/product-data/service',
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.endpoints).toEqual([
      expect.objectContaining({
        endpointName: 'ProductData',
        endpointVersion: null,
        versionDetectionStatus: 'failed',
        requiresManualVersionSelection: true,
        availableVersions: ['1.0.0', '2.0.0'],
      }),
    ]);
  });

  test('discovers endpoints from CompanyData and keeps the CompanyData URL as a saved endpoint row', async () => {
    mockListEndpointMappings.mockResolvedValue([
      {
        mapping_id: 51,
        endpoint_name: 'CompanyData',
        endpoint_version: '1.0.0',
        operation_name: 'getCompanyData',
        protocol: 'SOAP',
      },
      {
        mapping_id: 52,
        endpoint_name: 'ProductData',
        endpoint_version: '2.0.0',
        operation_name: 'getProduct',
        protocol: 'SOAP',
      },
    ]);
    mockInvokeEndpoint
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<Envelope><Body><getCompanyDataResponse /></Body></Envelope>',
        parsedBody: {
          getCompanyDataResponse: {
            PromoStandardsServiceDetailArray: {
              PromoStandardsServiceDetail: {
                serviceName: 'ProductData',
                serviceVersion: '2.0.0',
                url: 'https://vendor.example.com/ProductData/v2/GemlineProductDataService.svc?wsdl',
              },
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        rawPayload: '<Envelope><Body><getProductResponse /></Body></Envelope>',
        parsedBody: { getProductResponse: {} },
      });

    const result = await discoverPromostandardsEndpointsFromCompanyData({
      companyDataEndpointUrl: 'https://vendor.example.com/CompanyData/v1/CompanyDataService.svc',
      vendorAccountId: 'acct-1',
      vendorSecret: 'secret-1',
      protocol: 'SOAP',
    });

    expect(result.ok).toBe(true);
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpointName: 'CompanyData',
          endpointUrl: 'https://vendor.example.com/CompanyData/v1/CompanyDataService.svc',
          available: true,
        }),
        expect.objectContaining({
          endpointName: 'ProductData',
          endpointVersion: '2.0.0',
          endpointUrl: 'https://vendor.example.com/ProductData/v2/GemlineProductDataService.svc',
          available: true,
        }),
      ]),
    );
  });
});
