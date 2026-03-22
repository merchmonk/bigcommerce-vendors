const mockRequestJson = jest.fn();
const mockSyncProjectedProductContract = jest.fn();
const mockUpsertPriceListRecords = jest.fn();
const mockReconcileProjectedPricingTargets = jest.fn();

jest.mock('@lib/etl/bigcommerceApi', () => ({
  buildApiBase: (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}/v3`,
  requestJson: (...args: unknown[]) => mockRequestJson(...args),
}));

jest.mock('@lib/etl/bigcommerceMetafields', () => ({
  syncProjectedProductContract: (...args: unknown[]) => mockSyncProjectedProductContract(...args),
}));

jest.mock('@lib/etl/bigcommercePriceLists', () => ({
  upsertPriceListRecords: (...args: unknown[]) => mockUpsertPriceListRecords(...args),
}));

jest.mock('@lib/etl/pricingReconciliation', () => ({
  reconcileProjectedPricingTargets: (...args: unknown[]) => mockReconcileProjectedPricingTargets(...args),
}));

jest.mock('@lib/etl/productContractProjector', () => ({
  projectBigCommerceProductContract: jest.fn(() => ({
    product_designer_defaults: { contractVersion: '2026-03-22.1' },
    variant_designer_overrides: [],
  })),
}));

import { upsertBigCommerceProduct } from '@lib/etl/bigcommerceCatalog';

describe('upsertBigCommerceProduct media sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReconcileProjectedPricingTargets.mockReturnValue({
      missing_variant_ids: [],
      extra_variant_ids: [],
    });
  });

  test('replaces only vendor-managed media and uploads YouTube videos separately from the product payload', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const videoBodies: Array<Record<string, unknown>> = [];
    const deletedImageIds: number[] = [];
    const deletedVideoIds: number[] = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-1')) {
        return {
          data: [
            {
              id: 900,
              sku: 'SKU-1',
              name: 'Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/900') && method === 'PUT') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 900,
            sku: 'SKU-1',
            name: 'Product',
            base_variant_id: 901,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        return { data: { id: 1 } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 11,
              description: 'Old vendor image | mm_media:{"mediaType":"Image","url":"https://cdn.example.com/old.jpg"}',
            },
            {
              id: 12,
              description: 'Merchant-managed image',
            },
          ],
        };
      }

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 100 + imageBodies.length } };
      }

      if (url.match(/\/images\/\d+$/) && method === 'DELETE') {
        deletedImageIds.push(Number(url.split('/').pop()));
        return {};
      }

      if (url.endsWith('/videos?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 21,
              description: 'Old vendor video | mm_media:{"mediaType":"Video","url":"https://youtu.be/oldvideo"}',
            },
            {
              id: 22,
              description: 'Merchant-managed video',
            },
          ],
        };
      }

      if (url.endsWith('/videos') && method === 'POST') {
        videoBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 200 + videoBodies.length } };
      }

      if (url.match(/\/videos\/\d+$/) && method === 'DELETE') {
        deletedVideoIds.push(Number(url.split('/').pop()));
        return {};
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-1',
        source_sku: 'SKU-1',
        vendor_product_id: 'P-1',
        name: 'Product',
        description: 'Updated product',
        price: 10,
        cost_price: 8,
        media_assets: [
          {
            url: 'https://cdn.example.com/products/hero.jpg',
            media_type: 'Image',
            description: 'Hero image',
            class_types: ['Primary'],
          },
          {
            url: 'https://cdn.example.com/products/part-black.jpg',
            media_type: 'Image',
            description: 'Black part image',
            part_id: 'PART-BLK',
          },
          {
            url: 'https://www.youtube.com/watch?v=abc123xyz89',
            media_type: 'Video',
            description: 'Demo video',
            part_id: 'PART-BLK',
          },
          {
            url: 'https://cdn.example.com/products/demo.mp4',
            media_type: 'Video',
            description: 'MP4 clip',
          },
        ],
      },
    });

    expect(result.action).toBe('update');
    expect(productPayload).toEqual(
      expect.not.objectContaining({
        images: expect.anything(),
      }),
    );
    expect(imageBodies).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/hero.jpg',
        is_thumbnail: true,
      }),
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/part-black.jpg',
      }),
    ]);
    expect(imageBodies[0].description).toContain('mm_media:');
    expect(imageBodies[1].description).toContain('"partId":"PART-BLK"');
    expect(videoBodies).toEqual([
      expect.objectContaining({
        title: 'Demo video',
        type: 'youtube',
        video_id: 'abc123xyz89',
      }),
    ]);
    expect(videoBodies[0].description).toContain('mm_media:');
    expect(deletedImageIds).toEqual([11]);
    expect(deletedVideoIds).toEqual([21]);
    expect(mockSyncProjectedProductContract).toHaveBeenCalled();
    expect(mockUpsertPriceListRecords).toHaveBeenCalled();
  });

  test('skips invalid vendor category names instead of failing the product sync', async () => {
    const createdCategories: Array<{ name: string; parent_id: number }> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-2')) {
        return {
          data: [
            {
              id: 901,
              sku: 'SKU-2',
              name: 'Category Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Category%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        createdCategories.push({ name: body.name, parent_id: body.parent_id });
        return {
          data: {
            id: 1000 + createdCategories.length,
            name: body.name,
            parent_id: body.parent_id,
          },
        };
      }

      if (url.endsWith('/catalog/products/901') && method === 'PUT') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 901,
            sku: 'SKU-2',
            name: 'Category Product',
            base_variant_id: 902,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        return { data: { id: 1 } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/videos?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/images') && method === 'POST') {
        return { data: { id: 1 } };
      }

      if (url.endsWith('/videos') && method === 'POST') {
        return { data: { id: 1 } };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-2',
        source_sku: 'SKU-2',
        vendor_product_id: 'P-2',
        name: 'Category Product',
        price: 12,
        cost_price: 9,
        categories: [
          'Business accessories > Key rings',
          'Products manufactured by social compliant factories',
        ],
      },
    });

    expect(result.action).toBe('update');
    expect(createdCategories).toEqual([
      { name: 'Business accessories', parent_id: 0 },
      { name: 'Key rings', parent_id: 1001 },
    ]);
    expect(productPayload?.categories).toEqual([1002]);
  });

  test('skips invalid vendor brand names instead of failing the product sync', async () => {
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-3')) {
        return {
          data: [
            {
              id: 903,
              sku: 'SKU-3',
              name: 'Brand Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Brand%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/brands?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/brands') && method === 'POST') {
        throw new Error(
          'Failed to create BigCommerce brand (422): {"status":422,"errors":{"name":"name is invalid"}}',
        );
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/903') && method === 'PUT') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 903,
            sku: 'SKU-3',
            name: 'Brand Product',
            base_variant_id: 904,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        return { data: { id: 1 } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/videos?limit=250') && method === 'GET') {
        return { data: [] };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-3',
        source_sku: 'SKU-3',
        vendor_product_id: 'P-3',
        name: 'Brand Product',
        price: 12,
        cost_price: 9,
        brand_name: 'Products manufactured by social compliant factories',
      },
    });

    expect(result.action).toBe('update');
    expect(productPayload).toEqual(
      expect.not.objectContaining({
        brand_id: expect.anything(),
      }),
    );
  });

  test('skips overlong vendor brand names before attempting BigCommerce brand creation', async () => {
    let productPayload: Record<string, unknown> | undefined;
    const overlongBrandName = 'Brand '.repeat(21).trim();

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-4')) {
        return {
          data: [
            {
              id: 904,
              sku: 'SKU-4',
              name: 'Long Brand Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Long%20Brand%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/brands?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/brands') && method === 'POST') {
        throw new Error('Brand creation should not have been attempted');
      }

      if (url.endsWith('/catalog/products/904') && method === 'PUT') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 904,
            sku: 'SKU-4',
            name: 'Long Brand Product',
            base_variant_id: 905,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        return { data: { id: 1 } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/videos?limit=250') && method === 'GET') {
        return { data: [] };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-4',
        source_sku: 'SKU-4',
        vendor_product_id: 'P-4',
        name: 'Long Brand Product',
        price: 12,
        cost_price: 9,
        brand_name: overlongBrandName,
      },
    });

    expect(result.action).toBe('update');
    expect(productPayload).toEqual(
      expect.not.objectContaining({
        brand_id: expect.anything(),
      }),
    );
  });
});
