export {};

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@lib/prisma', () => ({
  __esModule: true,
  default: {
    vendor: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

jest.mock('@lib/etl/repository', () => ({
  replaceVendorEndpointMappings: jest.fn(),
}));

describe('vendors repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects creating a vendor when another vendor already uses the same normalized API URL', async () => {
    mockFindMany.mockResolvedValue([
      {
        vendor_id: 7,
        vendor_name: 'Existing Vendor',
        vendor_api_url: 'https://api.vendor.example.com/',
      },
    ]);

    const { createVendor } = await import('@lib/vendors');

    await expect(
      createVendor({
        vendor_name: 'Duplicate Vendor',
        integration_family: 'PROMOSTANDARDS',
        vendor_api_url: 'https://api.vendor.example.com',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'A vendor already exists for https://api.vendor.example.com (Existing Vendor).',
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('allows updating a vendor when the API URL belongs to the same vendor record', async () => {
    mockFindUnique.mockResolvedValue({
      vendor_id: 3,
      vendor_name: 'Same Vendor',
      vendor_type: 'SUPPLIER',
      vendor_api_url: 'https://api.vendor.example.com/',
      vendor_account_id: null,
      vendor_secret: null,
      integration_family: 'PROMOSTANDARDS',
      api_protocol: 'SOAP',
      connection_config: {},
      is_active: true,
      datetime_added: new Date('2026-03-21T00:00:00.000Z'),
      datetime_modified: new Date('2026-03-21T00:00:00.000Z'),
    });
    mockFindMany.mockResolvedValue([]);
    mockUpdate.mockResolvedValue({
      vendor_id: 3,
      vendor_name: 'Same Vendor',
      vendor_type: 'SUPPLIER',
      vendor_api_url: 'https://api.vendor.example.com',
      vendor_account_id: null,
      vendor_secret: null,
      integration_family: 'PROMOSTANDARDS',
      api_protocol: 'SOAP',
      connection_config: {},
      is_active: true,
      datetime_added: new Date('2026-03-21T00:00:00.000Z'),
      datetime_modified: new Date('2026-03-21T00:05:00.000Z'),
    });

    const { updateVendor } = await import('@lib/vendors');

    const result = await updateVendor(3, {
      vendor_api_url: 'https://api.vendor.example.com',
    });

    expect(result?.vendor_id).toBe(3);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
