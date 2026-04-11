const mockRequestJson = jest.fn();

jest.mock('@lib/etl/bigcommerceApi', () => ({
  buildApiBase: (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}/v3`,
  requestJson: (...args: unknown[]) => mockRequestJson(...args),
}));

import { resolveProductMetafieldValue, syncProjectedProductContract } from '@lib/etl/bigcommerceMetafields';

describe('syncProjectedProductContract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('does not delete a variant contract metafield when alias keys map to the same variant id', async () => {
    const variantMetafieldGets: string[] = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.endsWith('/catalog/products/501/metafields?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/501/metafields') && method === 'POST') {
        return { data: { id: 9001 } };
      }

      if (url.endsWith('/catalog/products/501/variants/1923/metafields?limit=250') && method === 'GET') {
        variantMetafieldGets.push(url);
        return {
          data: [
            {
              id: 4793,
              namespace: 'merchmonk',
              key: 'variant_designer_override',
              value: '{"contractVersion":"2026-03-22.1"}',
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/501/variants/1923/metafields/4793') && method === 'PUT') {
        return { data: { id: 4793 } };
      }

      if (url.endsWith('/catalog/products/501/variants/1923/metafields/4793') && method === 'DELETE') {
        throw new Error('variant metafield should not be deleted');
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await syncProjectedProductContract({
      accessToken: 'token',
      storeHash: 'xwhnc2uufe',
      productId: 501,
      productDesignerDefaults: {
        contractVersion: '2026-03-22.1',
      },
      variantDesignerOverrides: [
        {
          sku: 'MM500-BLA',
          value: {
            contractVersion: '2026-03-22.1',
            partId: '100062-001',
          },
        },
      ],
      variantIdsBySku: new Map([
        ['MM500-BLA', 1923],
        ['100062-001', 1923],
        ['100062', 1923],
      ]),
    });

    const productMetafieldListGets = mockRequestJson.mock.calls.filter(
      ([_token, url, options]) =>
        typeof url === 'string' &&
        url.endsWith('/catalog/products/501/metafields?limit=250') &&
        (options as RequestInit).method === 'GET',
    );
    expect(productMetafieldListGets).toHaveLength(1);
    expect(variantMetafieldGets).toHaveLength(2);
    expect(mockRequestJson).toHaveBeenCalledWith(
      'token',
      'https://api.bigcommerce.com/stores/xwhnc2uufe/v3/catalog/products/501/variants/1923/metafields/4793',
      expect.objectContaining({
        method: 'PUT',
      }),
      'Failed to update variant metafield',
    );
  });

  test('splits oversized product metafield payload into sequenced chunk keys', async () => {
    const oversizedText = 'a'.repeat(66000);
    const variantMetafieldGets: string[] = [];
    const productMetafieldPosts: Array<{ key: string; value: string }> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.endsWith('/catalog/products/501/metafields?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/501/metafields') && method === 'POST') {
        const parsedBody = JSON.parse((options.body as string) ?? '{}') as { key?: string; value?: string };
        productMetafieldPosts.push({ key: parsedBody.key ?? '', value: parsedBody.value ?? '' });
        return { data: { id: productMetafieldPosts.length + 9000 } };
      }

      if (url.endsWith('/catalog/products/501/variants/1923/metafields?limit=250') && method === 'GET') {
        variantMetafieldGets.push(url);
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/501/variants/1923/metafields') && method === 'POST') {
        return { data: { id: 4793 } };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await syncProjectedProductContract({
      accessToken: 'token',
      storeHash: 'xwhnc2uufe',
      productId: 501,
      productDesignerDefaults: {
        contractVersion: '2026-03-22.1',
        blob: oversizedText,
      },
      variantDesignerOverrides: [
        {
          sku: 'MM500-BLA',
          value: {
            contractVersion: '2026-03-22.1',
            partId: '100062-001',
          },
        },
      ],
      variantIdsBySku: new Map([['MM500-BLA', 1923]]),
    });

    const designerDefaultsChunks = productMetafieldPosts.filter(item =>
      item.key === 'product_designer_defaults' || item.key.startsWith('product_designer_defaults__part_'),
    );
    expect(designerDefaultsChunks).toHaveLength(2);
    expect(designerDefaultsChunks.map(item => item.key)).toEqual([
      'product_designer_defaults__part_1',
      'product_designer_defaults__part_2',
    ]);
    expect(Buffer.byteLength(designerDefaultsChunks[0].value, 'utf8')).toBeLessThanOrEqual(65535);
    expect(Buffer.byteLength(designerDefaultsChunks[1].value, 'utf8')).toBeLessThanOrEqual(65535);
    const productMetafieldListGets = mockRequestJson.mock.calls.filter(
      ([_token, url, options]) =>
        typeof url === 'string' &&
        url.endsWith('/catalog/products/501/metafields?limit=250') &&
        (options as RequestInit).method === 'GET',
    );
    expect(productMetafieldListGets).toHaveLength(1);
    expect(variantMetafieldGets).toHaveLength(2);
  });

  test('lists product metafields once when syncing designer defaults and multiple internal metafields', async () => {
    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.endsWith('/catalog/products/501/metafields?limit=250') && method === 'GET') {
        return {
          data: [
            { id: 1, namespace: 'merchmonk', key: 'pricing_configuration_configuration', value: '{}' },
            { id: 2, namespace: 'merchmonk', key: 'product_data_product', value: '{}' },
          ],
        };
      }

      if (url.includes('/catalog/products/501/metafields') && (method === 'POST' || method === 'PUT')) {
        return { data: { id: 999 } };
      }

      if (url.endsWith('/catalog/products/501/metafields/1') && method === 'DELETE') {
        return {};
      }

      if (url.endsWith('/catalog/products/501/metafields/2') && method === 'DELETE') {
        return {};
      }

      if (url.includes('/variants/') && url.endsWith('/metafields?limit=250') && method === 'GET') {
        return { data: [] };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await syncProjectedProductContract({
      accessToken: 'token',
      storeHash: 'xwhnc2uufe',
      productId: 501,
      productDesignerDefaults: { contractVersion: '2026-03-22.1' },
      productInternalMetafields: [
        { key: 'pricing_configuration_configuration', value: { contractVersion: '2026-03-22.1', parts: [] } },
        { key: 'product_data_product', value: { contractVersion: '2026-03-22.1', productData: {} } },
        { key: 'product_data_categories', value: { contractVersion: '2026-03-22.1', categories: [] } },
      ],
      variantDesignerOverrides: [],
      variantIdsBySku: new Map(),
    });

    const productMetafieldListGets = mockRequestJson.mock.calls.filter(
      ([_token, url, options]) =>
        typeof url === 'string' &&
        url.endsWith('/catalog/products/501/metafields?limit=250') &&
        (options as RequestInit).method === 'GET',
    );
    expect(productMetafieldListGets).toHaveLength(1);
  });
});

describe('resolveProductMetafieldValue', () => {
  test('joins ordered chunked metafield values', () => {
    const value = resolveProductMetafieldValue({
      namespace: 'merchmonk',
      key: 'product_designer_defaults',
      metafields: [
        { namespace: 'merchmonk', key: 'product_designer_defaults__part_2', value: 'world"}' },
        { namespace: 'merchmonk', key: 'product_designer_defaults__part_1', value: '{"hello":"' },
      ],
    });

    expect(value).toBe('{"hello":"world"}');
  });
});
