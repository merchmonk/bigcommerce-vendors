import { resolveVendorOrderGroups } from '@lib/orders/orderVendorSplit';

const mockFindVendorProductMapsByBigCommerceProductIds = jest.fn();
const mockGetBigCommerceCatalogOrderContextProduct = jest.fn();

jest.mock('@lib/etl/repository', () => ({
  findVendorProductMapsByBigCommerceProductIds: (...args: unknown[]) =>
    mockFindVendorProductMapsByBigCommerceProductIds(...args),
}));

jest.mock('@lib/orders/bigcommerceOrderReader', () => ({
  getBigCommerceCatalogOrderContextProduct: (...args: unknown[]) =>
    mockGetBigCommerceCatalogOrderContextProduct(...args),
}));

describe('orderVendorSplit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('groups BigCommerce order lines by vendor using synced product map records', async () => {
    mockFindVendorProductMapsByBigCommerceProductIds.mockResolvedValue([
      {
        vendor_id: 14,
        vendor_product_id: 'SUP-TEE-100',
        bigcommerce_product_id: 501,
        sku: 'TS-BLK-M',
      },
      {
        vendor_id: 22,
        vendor_product_id: 'SUP-MUG-200',
        bigcommerce_product_id: 777,
        sku: 'MUG-WHT',
      },
    ]);

    const result = await resolveVendorOrderGroups({
      accessToken: 'token',
      storeHash: 'abc123',
      externalOrderId: '1001',
      orderBundle: {
        order: { id: 1001 },
        products: [
          {
            id: 10,
            product_id: 501,
            sku: 'TS-BLK-M',
            quantity: 24,
          },
          {
            id: 11,
            product_id: 777,
            sku: 'MUG-WHT',
            quantity: 12,
          },
        ],
        shippingAddresses: [],
      },
    });

    expect(mockFindVendorProductMapsByBigCommerceProductIds).toHaveBeenCalledWith([501, 777]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      vendor_id: 14,
      purchase_order_number: 'MM-1001-V14',
      line_count: 1,
    });
    expect(result[1]).toMatchObject({
      vendor_id: 22,
      purchase_order_number: 'MM-1001-V22',
      line_count: 1,
    });
  });

  test('falls back to the BigCommerce product vendor_id custom field when no synced product map exists', async () => {
    mockFindVendorProductMapsByBigCommerceProductIds.mockResolvedValue([]);
    mockGetBigCommerceCatalogOrderContextProduct.mockResolvedValue({
      id: 501,
      custom_fields: [
        {
          name: 'vendor_id',
          value: '33',
        },
      ],
    });

    const result = await resolveVendorOrderGroups({
      accessToken: 'token',
      storeHash: 'abc123',
      externalOrderId: '1001',
      orderBundle: {
        order: { id: 1001 },
        products: [
          {
            id: 10,
            product_id: 501,
            sku: 'TS-BLK-M',
            quantity: 24,
          },
        ],
        shippingAddresses: [],
      },
    });

    expect(mockGetBigCommerceCatalogOrderContextProduct).toHaveBeenCalledWith({
      accessToken: 'token',
      storeHash: 'abc123',
      productId: 501,
    });
    expect(result[0]).toMatchObject({
      vendor_id: 33,
      purchase_order_number: 'MM-1001-V33',
    });
  });
});
