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
        promostandards_capabilities: {
          fingerprint,
          tested_at: '2026-03-21T23:00:00.000Z',
          available_endpoint_count: 1,
          credentials_valid: true,
          endpoints: [],
        },
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
        },
      ],
    });
    expect(prepared.vendorInput.connection_config).toEqual({
      promostandards_capabilities: {
        fingerprint,
        tested_at: '2026-03-21T23:00:00.000Z',
        available_endpoint_count: 1,
        credentials_valid: true,
        endpoints: [
          {
            endpoint_name: 'CompanyData',
            endpoint_version: '1.0.0',
            operation_name: 'getCompanyData',
            capability_scope: 'catalog',
            lifecycle_role: undefined,
            optional_by_vendor: undefined,
            recommended_poll_minutes: null,
            available: true,
            status_code: null,
            message: 'Endpoint selected from PromoStandards discovery.',
            wsdl_available: null,
            credentials_valid: true,
            live_probe_message: null,
            resolved_endpoint_url: null,
            custom_endpoint_url: null,
          },
        ],
      },
    });
  });

  test('persists custom PromoStandards endpoint URLs into mapping runtime config', async () => {
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
      vendor_api_url: 'https://vendor.example.com',
      vendor_account_id: 'acct-1',
      vendor_secret: 'secret-1',
      api_protocol: 'SOAP',
    });

    const prepared = await prepareVendorSubmission({
      body: {
        vendor_name: 'Vendor',
        vendor_type: 'SUPPLIER',
        vendor_api_url: 'https://vendor.example.com',
        vendor_account_id: 'acct-1',
        vendor_secret: 'secret-1',
        integration_family: 'PROMOSTANDARDS',
        api_protocol: 'SOAP',
        endpoint_mapping_ids: [201],
        promostandards_capabilities: {
          fingerprint,
          tested_at: '2026-03-22T18:20:00.000Z',
          available_endpoint_count: 1,
          credentials_valid: true,
          endpoints: [
            {
              endpoint_name: 'PricingAndConfiguration',
              endpoint_version: '1.0.0',
              operation_name: 'getConfigurationAndPricing',
              available: true,
              status_code: 200,
              message: 'Operation listed in endpoint WSDL.',
              resolved_endpoint_url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
              custom_endpoint_url: '/custom/pricing/soap',
            },
          ],
        },
      },
    });

    expect(prepared.mappingAction).toEqual({
      type: 'apply',
      resolvedDrafts: [
        {
          mappingId: 201,
          enabled: true,
          runtimeConfig: {
            endpoint_path: '/custom/pricing/soap',
          },
        },
      ],
    });
    expect(prepared.vendorInput.connection_config).toEqual({
      promostandards_capabilities: {
        fingerprint,
        tested_at: '2026-03-22T18:20:00.000Z',
        available_endpoint_count: 1,
        credentials_valid: true,
        endpoints: [
          expect.objectContaining({
            endpoint_name: 'PricingAndConfiguration',
            resolved_endpoint_url: 'https://vendor.example.com/api/promostandards/PPC/1.0.0/soap',
            custom_endpoint_url: '/custom/pricing/soap',
          }),
        ],
      },
    });
  });
});
