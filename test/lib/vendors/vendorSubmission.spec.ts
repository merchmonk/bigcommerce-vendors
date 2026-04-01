const mockListEndpointMappingsByIds = jest.fn();
const mockResolveMappingDrafts = jest.fn();
const mockResolvePromostandardsCapabilityMappings = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  listEndpointMappingsByIds: (...args: unknown[]) => mockListEndpointMappingsByIds(...args),
}));

jest.mock('@lib/etl/mappingDrafts', () => ({
  resolveMappingDrafts: (...args: unknown[]) => mockResolveMappingDrafts(...args),
}));

jest.mock('@lib/vendors/promostandardsDiscovery', () => {
  const actual = jest.requireActual('@lib/vendors/promostandardsDiscovery');
  return {
    ...actual,
    resolvePromostandardsCapabilityMappings: (...args: unknown[]) =>
      mockResolvePromostandardsCapabilityMappings(...args),
  };
});

describe('prepareVendorSubmission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses submitted PromoStandards mapping ids and rebuilds stored capabilities from the catalog', async () => {
    mockListEndpointMappingsByIds.mockResolvedValue([
      {
        mapping_id: 101,
        endpoint_name: 'CompanyData',
        endpoint_version: '1.0.0',
        operation_name: 'getCompanyData',
        metadata: {
          capability_scope: 'catalog',
        },
      },
    ]);

    const { buildPromostandardsConnectionFingerprint } = await import('@lib/vendors/promostandardsDiscovery');
    const { prepareVendorSubmission } = await import('@lib/vendors/vendorSubmission');
    const fingerprint = buildPromostandardsConnectionFingerprint({
      vendor_api_url: 'https://www.spectorapps.com',
      vendor_account_id: 'acct-1',
      vendor_secret: 'secret-1',
      api_protocol: 'SOAP',
    });

    const prepared = await prepareVendorSubmission({
      body: {
        vendor_name: 'Spector',
        vendor_type: 'SUPPLIER',
        vendor_api_url: 'https://www.spectorapps.com',
        vendor_account_id: 'acct-1',
        vendor_secret: 'secret-1',
        integration_family: 'PROMOSTANDARDS',
        api_protocol: 'SOAP',
        endpoint_mapping_ids: [101],
        promostandardsCapabilities: {
          fingerprint,
          testedAt: '2026-03-21T23:00:00.000Z',
          availableEndpointCount: 1,
          credentialsValid: true,
          endpoints: [
            {
              endpointName: 'CompanyData',
              endpointVersion: '1.0.0',
              endpointUrl: 'https://www.spectorapps.com/companydata/1.0.0',
              available: true,
              status_code: 200,
              message: 'ok',
            },
          ],
        },
        connection_tested: true,
      },
    });

    expect(mockResolvePromostandardsCapabilityMappings).not.toHaveBeenCalled();
    expect(mockListEndpointMappingsByIds).toHaveBeenCalledWith([101]);
    expect(prepared.mappingAction).toEqual({
      type: 'apply',
      resolvedDrafts: [
        {
          mappingId: 101,
          enabled: true,
          runtimeConfig: {},
          endpointUrl: 'https://www.spectorapps.com/companydata/1.0.0',
        },
      ],
    });
    expect(prepared.vendorInput.connection_config).toEqual({
      promostandards_capabilities: {
        fingerprint,
        testedAt: '2026-03-21T23:00:00.000Z',
        availableEndpointCount: 1,
        credentialsValid: true,
        endpoints: [
          {
            endpointName: 'CompanyData',
            endpointVersion: '1.0.0',
            endpointUrl: 'https://www.spectorapps.com/companydata/1.0.0',
            available: true,
            status_code: 200,
            message: 'ok',
          },
        ],
      },
    });
  });

  test('persists full PromoStandards endpoint URLs onto resolved drafts', async () => {
    mockListEndpointMappingsByIds.mockResolvedValue([
      {
        mapping_id: 201,
        endpoint_name: 'PricingAndConfiguration',
        endpoint_version: '1.0.0',
        operation_name: 'getConfigurationAndPricing',
        metadata: {
          capability_scope: 'catalog',
        },
      },
    ]);

    const { buildPromostandardsConnectionFingerprint } = await import('@lib/vendors/promostandardsDiscovery');
    const { prepareVendorSubmission } = await import('@lib/vendors/vendorSubmission');
    const fingerprint = buildPromostandardsConnectionFingerprint({
      vendor_account_id: 'acct-1',
      vendor_secret: 'secret-1',
      api_protocol: 'SOAP',
    });

    const prepared = await prepareVendorSubmission({
      body: {
        vendor_name: 'Vendor',
        vendor_type: 'SUPPLIER',
        vendor_account_id: 'acct-1',
        vendor_secret: 'secret-1',
        integration_family: 'PROMOSTANDARDS',
        api_protocol: 'SOAP',
        endpoint_mapping_ids: [201],
        promostandardsCapabilities: {
          fingerprint,
          testedAt: '2026-03-22T18:20:00.000Z',
          availableEndpointCount: 1,
          credentialsValid: true,
          endpoints: [
            {
              endpointName: 'PricingAndConfiguration',
              endpointVersion: '1.0.0',
              endpointUrl: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
              available: true,
              status_code: 200,
              message: 'Operation listed in endpoint WSDL.',
            },
          ],
        },
        connection_tested: true,
      },
    });

    expect(prepared.mappingAction).toEqual({
      type: 'apply',
      resolvedDrafts: [
        {
          mappingId: 201,
          enabled: true,
          runtimeConfig: {},
          endpointUrl: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
        },
      ],
    });
    expect(prepared.vendorInput.connection_config).toEqual({
      promostandards_capabilities: {
        fingerprint,
        testedAt: '2026-03-22T18:20:00.000Z',
        availableEndpointCount: 1,
        credentialsValid: true,
        endpoints: [
          expect.objectContaining({
            endpointName: 'PricingAndConfiguration',
            endpointUrl: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
          }),
        ],
      },
    });
  });
});
