const mockRequestJson = jest.fn();
const mockListProductMetafields = jest.fn();
const mockListVariantMetafields = jest.fn();

jest.mock('@lib/etl/bigcommerceApi', () => ({
  buildApiBase: (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}/v3`,
  buildApiV2Base: (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}/v2`,
  requestJson: (...args: unknown[]) => mockRequestJson(...args),
}));

jest.mock('@lib/etl/bigcommerceMetafields', () => ({
  listProductMetafields: (...args: unknown[]) => mockListProductMetafields(...args),
  listVariantMetafields: (...args: unknown[]) => mockListVariantMetafields(...args),
}));

import { loadBigCommerceDesignerRuntimeBundle } from '@lib/storefront/bigcommerceRuntimeReader';

describe('loadBigCommerceDesignerRuntimeBundle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListProductMetafields.mockResolvedValue([]);
    mockListVariantMetafields.mockResolvedValue([]);
  });

  test('loads related products through the v2 related_products field', async () => {
    mockRequestJson.mockImplementation(async (_accessToken, url: string) => {
      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/products/500?include=custom_fields,images') {
        return {
          data: {
            id: 500,
            name: 'Primary Product',
            sku: 'MM500',
            brand_id: 12,
            categories: [44],
          },
        };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/products/500/variants?limit=250') {
        return {
          data: [
            {
              id: 1923,
              sku: 'MM500-BLA',
            },
          ],
        };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/products/500/modifiers?limit=250') {
        return { data: [] };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v2/products/500') {
        return {
          related_products: '501,502',
        };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/brands/12') {
        return { data: { id: 12, name: 'Brand' } };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/categories?limit=250') {
        return { data: [{ id: 44, name: 'Bags' }] };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/products/501?include=custom_fields,images') {
        return { data: { id: 501, name: 'Related 1', sku: 'MM501' } };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v3/catalog/products/502?include=custom_fields,images') {
        return { data: { id: 502, name: 'Related 2', sku: 'MM502' } };
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    const bundle = await loadBigCommerceDesignerRuntimeBundle({
      accessToken: 'token',
      storeHash: 'storehash',
      productId: 500,
      variantId: 1923,
    });

    expect(bundle.relatedProducts.map(product => product.id)).toEqual([501, 502]);
  });
});
