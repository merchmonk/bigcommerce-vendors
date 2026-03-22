export {};

const mockFindMany = jest.fn();
const mockSeedPromoStandardsMappings = jest.fn();

jest.mock('@lib/prisma', () => ({
  __esModule: true,
  default: {
    endpointMapping: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

jest.mock('@lib/etl/promostandardsSeed', () => ({
  seedPromoStandardsMappings: (...args: unknown[]) => mockSeedPromoStandardsMappings(...args),
}));

describe('endpoint mapping repository', () => {
  beforeEach(() => {
    jest.resetModules();
    mockFindMany.mockReset();
    mockSeedPromoStandardsMappings.mockReset();
    mockFindMany.mockResolvedValue([]);
    mockSeedPromoStandardsMappings.mockResolvedValue([]);
  });

  test('seeds PromoStandards mappings before listing them', async () => {
    const { listEndpointMappings } = await import('@lib/etl/repository');

    await listEndpointMappings({ standard_type: 'PROMOSTANDARDS', protocol: 'SOAP' });

    expect(mockSeedPromoStandardsMappings).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test('seeds PromoStandards mappings before resolving endpoint operations', async () => {
    const { findMappingsByEndpointOperations } = await import('@lib/etl/repository');

    await findMappingsByEndpointOperations([
      {
        endpoint_name: 'Inventory',
        endpoint_version: '2.0.0',
        operation_name: 'getInventoryLevels',
      },
    ]);

    expect(mockSeedPromoStandardsMappings).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  test('does not seed when only custom mappings are requested', async () => {
    const { listEndpointMappings } = await import('@lib/etl/repository');

    await listEndpointMappings({ standard_type: 'CUSTOM' });

    expect(mockSeedPromoStandardsMappings).not.toHaveBeenCalled();
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });
});
