import { applyVendorMappingDrafts, resolveMappingDrafts } from '@lib/etl/mappingDrafts';

const mockReplaceVendorEndpointMappings = jest.fn();
const mockUpsertEndpointMapping = jest.fn();
const mockUpsertVendorEndpointMapping = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  replaceVendorEndpointMappings: (...args: unknown[]) => mockReplaceVendorEndpointMappings(...args),
  upsertEndpointMapping: (...args: unknown[]) => mockUpsertEndpointMapping(...args),
  upsertVendorEndpointMapping: (...args: unknown[]) => mockUpsertVendorEndpointMapping(...args),
}));

describe('mappingDrafts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upserts enabled mapping drafts and returns mapping ids', async () => {
    mockUpsertEndpointMapping.mockResolvedValue({
      mapping_id: 321,
    });

    const resolved = await resolveMappingDrafts({
      integrationFamily: 'CUSTOM',
      defaultProtocol: 'JSON',
      drafts: [
        {
          enabled: true,
          endpoint_name: 'Items',
          endpoint_version: '1',
          operation_name: 'listItems',
          protocol: 'REST',
          payload_format: 'JSON',
          structure_input: '{"path":"items"}',
        },
      ],
    });

    expect(mockUpsertEndpointMapping).toHaveBeenCalledTimes(1);
    expect(resolved).toEqual([
      {
        mappingId: 321,
        enabled: true,
        runtimeConfig: {},
      },
    ]);
  });

  test('rejects invalid JSON mapping structures', async () => {
    await expect(
      resolveMappingDrafts({
        integrationFamily: 'CUSTOM',
        defaultProtocol: 'JSON',
        drafts: [
          {
            enabled: true,
            endpoint_name: 'Items',
            endpoint_version: '1',
            operation_name: 'listItems',
            payload_format: 'JSON',
            structure_input: '{bad json}',
          },
        ],
      }),
    ).rejects.toThrow('Invalid JSON structure provided in mapping draft');
  });

  test('replaces vendor mappings and writes runtime config', async () => {
    await applyVendorMappingDrafts(55, [
      {
        mappingId: 4,
        enabled: true,
        runtimeConfig: { endpoint_url: 'https://example.com' },
      },
    ]);

    expect(mockReplaceVendorEndpointMappings).toHaveBeenCalledWith(55, [4]);
    expect(mockUpsertVendorEndpointMapping).toHaveBeenCalledWith({
      vendor_id: 55,
      mapping_id: 4,
      is_enabled: true,
      runtime_config: { endpoint_url: 'https://example.com' },
    });
  });
});
