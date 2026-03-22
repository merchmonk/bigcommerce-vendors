import {
  buildPromostandardsConnectionFingerprint,
  discoverPromostandardsCapabilities,
  resolvePromostandardsCapabilityMappings,
} from '@lib/vendors/promostandardsDiscovery';

const mockListEndpointMappings = jest.fn();
const mockFindMappingsByEndpointOperations = jest.fn();
const mockResolveEndpointAdapter = jest.fn();
const mockInvokeEndpoint = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  listEndpointMappings: (...args: unknown[]) => mockListEndpointMappings(...args),
  findMappingsByEndpointOperations: (...args: unknown[]) => mockFindMappingsByEndpointOperations(...args),
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

  test('discovers endpoint availability from grouped PromoStandards mappings', async () => {
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
    expect(result.available_endpoint_count).toBe(2);
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint_name: 'CompanyData',
          endpoint_version: '1.0.0',
          operation_name: 'getCompanyData',
          available: true,
        }),
        expect.objectContaining({
          endpoint_name: 'Inventory',
          endpoint_version: '1.2.1',
          operation_name: 'getInventoryLevels',
          available: true,
        }),
        expect.objectContaining({
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
          available: false,
        }),
        expect.objectContaining({
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          available: false,
        }),
      ]),
    );
    expect(mockInvokeEndpoint).toHaveBeenCalledTimes(4);
  });

  test('treats request-field not found SOAP faults as live probe validation responses', async () => {
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

    expect(result.credentials_valid).toBe(true);
    expect(result.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          credentials_valid: true,
          live_probe_message: 'WsVersion not found.',
        }),
      ]),
    );
  });

  test('resolves mapping ids from available endpoint versions', async () => {
    mockFindMappingsByEndpointOperations.mockResolvedValue([
      { mapping_id: 11 },
      { mapping_id: 12 },
      { mapping_id: 13 },
    ]);

    const mappingIds = await resolvePromostandardsCapabilityMappings({
      endpoints: [
        {
          endpoint_name: 'CompanyData',
          endpoint_version: '1.0.0',
          operation_name: 'getCompanyData',
          available: true,
          status_code: 200,
          message: 'ok',
        },
        {
          endpoint_name: 'Inventory',
          endpoint_version: '1.2.1',
          operation_name: 'getInventoryLevels',
          available: false,
          status_code: 500,
          message: 'unsupported',
        },
      ],
    });

    expect(mockFindMappingsByEndpointOperations).toHaveBeenCalledWith([
      {
        endpoint_name: 'CompanyData',
        endpoint_version: '1.0.0',
        operation_name: 'getCompanyData',
      },
    ]);
    expect(mappingIds).toEqual([11, 12, 13]);
  });

  test('prefers the highest available endpoint version per endpoint operation', async () => {
    mockFindMappingsByEndpointOperations.mockResolvedValue([
      { mapping_id: 21 },
      { mapping_id: 22 },
    ]);

    const mappingIds = await resolvePromostandardsCapabilityMappings({
      endpoints: [
        {
          endpoint_name: 'ProductData',
          endpoint_version: '1.0.0',
          operation_name: 'getProduct',
          available: true,
          status_code: 200,
          message: 'ok',
        },
        {
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProduct',
          available: true,
          status_code: 200,
          message: 'ok',
        },
        {
          endpoint_name: 'ProductData',
          endpoint_version: '2.1.0',
          operation_name: 'getProductSellable',
          available: true,
          status_code: 200,
          message: 'ok',
        },
        {
          endpoint_name: 'ProductData',
          endpoint_version: '2.0.0',
          operation_name: 'getProductSellable',
          available: true,
          status_code: 200,
          message: 'ok',
        },
      ],
    });

    expect(mockFindMappingsByEndpointOperations).toHaveBeenCalledWith([
      {
        endpoint_name: 'ProductData',
        endpoint_version: '2.0.0',
        operation_name: 'getProduct',
      },
      {
        endpoint_name: 'ProductData',
        endpoint_version: '2.1.0',
        operation_name: 'getProductSellable',
      },
    ]);
    expect(mappingIds).toEqual([21, 22]);
  });
});
