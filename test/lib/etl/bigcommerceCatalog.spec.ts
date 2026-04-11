const mockRequestJson = jest.fn();
const mockSyncProjectedProductContract = jest.fn();
const mockUpsertPriceListRecords = jest.fn();
const mockReconcileProjectedPricingTargets = jest.fn();
const mockProjectBigCommerceProductContract = jest.fn(
  (
    product: { sku?: string; variants?: Array<{ sku?: string }> },
    _context?: unknown,
  ) => ({
    product_designer_defaults: {
      contractVersion: '2026-03-22.1',
      sku: product.sku,
      variantCatalog: (product.variants ?? []).map(variant => ({ sku: variant.sku })),
      media: product.sku ? { gallery: [{ sku: product.sku }] } : undefined,
    },
    variant_designer_overrides: [],
    product_internal_metafields: [
      {
        key: 'pricing_configuration_configuration',
        value: { contractVersion: '2026-03-22.1' },
      },
    ],
  }),
);

jest.mock('@lib/etl/bigcommerceApi', () => ({
  buildApiBase: (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}/v3`,
  buildApiV2Base: (storeHash: string) => `https://api.bigcommerce.com/stores/${storeHash}/v2`,
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
  projectBigCommerceProductContract: (product: unknown, context: unknown) =>
    mockProjectBigCommerceProductContract(product, context),
}));

import { syncBigCommerceInventoryBatch, upsertBigCommerceProduct, upsertRelatedProducts } from '@lib/etl/bigcommerceCatalog';

const originalFetch = globalThis.fetch;

describe('upsertBigCommerceProduct media sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReconcileProjectedPricingTargets.mockReturnValue({
      missing_variant_ids: [],
      extra_variant_ids: [],
    });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => {
          if (name.toLowerCase() === 'content-type') {
            return 'image/jpeg';
          }
          return null;
        },
      },
      body: {
        cancel: jest.fn().mockResolvedValue(undefined),
      },
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
    } as unknown as Response);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('replaces only vendor-managed images and does not call the BigCommerce video API', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const deletedImageIds: number[] = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-1')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
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

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        return { data: { id: 1 } };
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

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 100 + imageBodies.length } };
      }

      if (url.match(/\/images\/\d+$/) && method === 'DELETE') {
        deletedImageIds.push(Number(url.split('/').pop()));
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
        weight: 0.25,
        media_assets: [
          {
            url: 'https://cdn.example.com/products/hero.jpg',
            media_type: 'Image',
            description: 'Hero image',
            product_id: 'P-1',
            class_type_array: [{ class_type_id: '1001', class_type_name: 'Blank' }],
            file_size: 204800,
          },
          {
            url: 'https://cdn.example.com/products/part black.jpg',
            media_type: 'Image',
            description: 'Black part image',
            product_id: 'P-1',
            part_id: 'PART-BLK',
            class_type_array: [
              { class_type_id: '1002', class_type_name: 'Decorated' },
              { class_type_id: '1006', class_type_name: 'Primary' },
            ],
            location_ids: ['LOC-FRONT'],
            decoration_ids: ['DEC-SCREEN'],
            file_size: 5938103,
            width: 1200,
            height: 1200,
            color: 'Black',
            single_part: true,
            change_timestamp: '2026-03-22T12:01:00Z',
          },
        /*  {
            url: 'https://www.youtube.com/watch?v=abc123xyz89',
            media_type: 'Video',
            description: 'Demo video',
            part_id: 'PART-BLK',
          },
          {
            url: 'https://cdn.example.com/products/demo.mp4',
            media_type: 'Video',
            description: 'MP4 clip',
          },*/
        ],
        pricing_configuration: {
          locations: [
            {
              location_id: 'LOC-FRONT',
              location_name: 'Front Pocket',
              decorations: [
                {
                  decoration_id: 'DEC-SCREEN',
                  decoration_name: 'Screen Print',
                  charges: [],
                },
              ],
            },
          ],
          parts: [],
          fob_points: [],
        },
      },
    });

    expect(result.action).toBe('create');
    expect(productPayload).toEqual(
      expect.not.objectContaining({
        images: expect.anything(),
      }),
    );
    expect(imageBodies).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/hero.jpg',
      }),
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/part%20black.jpg',
        is_thumbnail: true,
      }),
    ]);
    expect(imageBodies[0].description).not.toContain('mm_media:');
    expect(imageBodies[0].description).not.toContain('"productId"');
    expect(imageBodies[0].description).not.toContain('"classTypeArray"');
    expect(imageBodies[0].description).not.toContain('"fileSize"');
    expect(imageBodies[1].description).toContain('"partId":"PART-BLK"');
    expect(imageBodies[1].description).not.toContain('"productId"');
    expect(imageBodies[1].description).not.toContain('"classTypeArray"');
    expect(imageBodies[1].description).toContain('"classTypes":["Decorated","Primary"]');
    expect(imageBodies[1].description).not.toContain('"url"');
    expect(imageBodies[1].description).not.toContain('"mediaType"');
    expect(imageBodies[1].description).not.toContain('"description"');
    expect(imageBodies[1].description).not.toContain('"locationIds"');
    expect(imageBodies[1].description).not.toContain('"locationArray"');
    expect(imageBodies[1].description).not.toContain('"locationNames"');
    expect(imageBodies[1].description).not.toContain('"decorationIds"');
    expect(imageBodies[1].description).not.toContain('"decorationArray"');
    expect(imageBodies[1].description).not.toContain('"decorationNames"');
    expect(imageBodies[1].description).not.toContain('"fileSize"');
    expect(imageBodies[1].description).not.toContain('"width"');
    expect(imageBodies[1].description).not.toContain('"height"');
    expect(imageBodies[1].description).not.toContain('"color"');
    expect(imageBodies[1].description).not.toContain('"singlePart"');
    expect(imageBodies[1].description).not.toContain('"changeTimeStamp"');
    expect(deletedImageIds).toEqual([]);
    expect(mockSyncProjectedProductContract).toHaveBeenCalled();
    expect(mockUpsertPriceListRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            currency: 'USD',
          }),
        ]),
      }),
    );
  });

  test('skips oversized BigCommerce product images without failing the product sync', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const originalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    (globalThis as unknown as { fetch?: jest.Mock }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: () => null,
      },
    } as unknown as Response);

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-OVERSIZE')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Oversized%20Image%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 905,
            sku: 'SKU-OVERSIZE',
            name: 'Oversized Image Product',
            base_variant_id: 906,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        return { data: { id: 1 } };
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

      if (url.endsWith('/images') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        if (String(body.image_url).includes('oversized.jpg')) {
          throw new Error(
            'Failed to create BigCommerce product image (422): {"status":422,"code":10001,"title":"The maximum of 8 MB size limit for upload image is exceeded","type":"https://developer.bigcommerce.com/api-docs/getting-started/api-status-codes"}',
          );
        }
        imageBodies.push(body);
        return { data: { id: 100 + imageBodies.length } };
      }

      if (url.endsWith('/videos?limit=250') && method === 'GET') {
        return { data: [] };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      upsertBigCommerceProduct({
        accessToken: 'token',
        storeHash: 'abc123',
        vendorId: 22,
        defaultMarkupPercent: 30,
        product: {
          sku: 'SKU-OVERSIZE',
          source_sku: 'SKU-OVERSIZE',
          vendor_product_id: 'P-OVERSIZE',
          name: 'Oversized Image Product',
          description: 'Updated product',
          price: 10,
          cost_price: 8,
          media_assets: [
            {
              url: 'https://cdn.example.com/products/oversized.jpg',
              media_type: 'Image',
              description: 'Oversized source image',
            },
            {
              url: 'https://cdn.example.com/products/allowed.jpg',
              media_type: 'Image',
              description: 'Allowed source image',
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: 'create',
      }),
    );

    expect(imageBodies).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/allowed.jpg',
      }),
    ]);

    (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
  });

  test('routes PromoStandards net pricing into the default and blanks price lists with the correct markup rules', async () => {
    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-PRICE')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Price%20List%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 910,
            sku: 'SKU-PRICE',
            name: 'Price List Product',
            base_variant_id: 911,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        return { data: { id: 1 } };
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

    await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      product: {
        sku: 'SKU-PRICE',
        source_sku: 'SKU-PRICE',
        vendor_product_id: 'P-PRICE',
        name: 'Price List Product',
        pricing_configuration: {
          parts: [
            {
              part_id: 'SKU-PRICE',
              default_part: true,
              price_tiers: [
                {
                  min_quantity: 1,
                  price: 10,
                  currency: 'USD',
                  price_type: 'Net',
                  configuration_type: 'Blank',
                },
                {
                  min_quantity: 24,
                  price: 9.5,
                  currency: 'USD',
                  price_type: 'Net',
                  configuration_type: 'Blank',
                },
                {
                  min_quantity: 1,
                  price: 16,
                  currency: 'USD',
                  price_type: 'Net',
                  configuration_type: 'Decorated',
                },
                {
                  min_quantity: 24,
                  price: 15,
                  currency: 'USD',
                  price_type: 'Net',
                  configuration_type: 'Decorated',
                },
              ],
            },
          ],
          locations: [],
          fob_points: [],
        },
      },
      pricingContext: {
        markup_percent: 30,
        price_list_id: 1,
        blanks_price_list_id: 2,
        currency: 'USD',
        markup_namespace: 'merchmonk',
        markup_key: 'product_markup',
      },
    });

    expect(mockUpsertPriceListRecords).toHaveBeenCalledTimes(2);
    expect(mockUpsertPriceListRecords).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        price_list_id: 1,
        records: [
          {
            variant_id: 911,
            price: 22.86,
            currency: 'USD',
            bulk_pricing_tiers: [
              {
                quantity_min: 24,
                type: 'price',
                amount: 21.43,
              },
            ],
          },
        ],
      }),
    );
    expect(mockUpsertPriceListRecords).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        price_list_id: 2,
        records: [
          {
            variant_id: 911,
            price: 10,
            currency: 'USD',
            bulk_pricing_tiers: [
              {
                quantity_min: 24,
                type: 'price',
                amount: 9.5,
              },
            ],
          },
        ],
      }),
    );
  });

  test('skips invalid vendor category names instead of failing the product sync', async () => {
    const createdCategories: Array<{ name: string; parent_id: number }> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-2')) {
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

      if (url.endsWith('/catalog/products') && method === 'POST') {
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

    expect(result.action).toBe('create');
    expect(createdCategories).toEqual([
      { name: 'Business Accessories', parent_id: 0 },
      { name: 'Key Rings', parent_id: 1001 },
    ]);
    expect(productPayload?.categories).toEqual([1002]);
  });

  test('reuses existing pluralized categories before creating new ones', async () => {
    const createdCategories: Array<{ name: string; parent_id: number }> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-CATEGORY-PLURAL')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return {
          data: [
            { id: 2001, name: 'Business Accessories', parent_id: 0 },
            { id: 2002, name: 'Backpacks', parent_id: 2001 },
          ],
        };
      }

      if (url.endsWith('/catalog/categories') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        createdCategories.push({ name: body.name, parent_id: body.parent_id });
        return {
          data: {
            id: 3000 + createdCategories.length,
            name: body.name,
            parent_id: body.parent_id,
          },
        };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 905,
            sku: 'SKU-CATEGORY-PLURAL',
            name: 'Pluralized Category Product',
            base_variant_id: 906,
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

      if (url.endsWith('/images') && method === 'POST') {
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
        sku: 'SKU-CATEGORY-PLURAL',
        source_sku: 'SKU-CATEGORY-PLURAL',
        vendor_product_id: 'P-CATEGORY-PLURAL',
        name: 'Pluralized Category Product',
        price: 12,
        cost_price: 9,
        categories: ['business accessory > backpack'],
      },
    });

    expect(result.action).toBe('create');
    expect(createdCategories).toEqual([]);
    expect(productPayload?.categories).toEqual([2002]);
  });

  test('does not resend product custom fields on update', async () => {
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233353')) {
        return {
          data: [
            {
              id: 990,
              sku: 'SKU-CF',
              name: 'Custom Field Product',
              upc: '00011122233353',
              custom_fields: [
                { name: 'vendor_id', value: '22' },
                { name: 'vendor_endpoint', value: 'ProductData' },
              ],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/990') && method === 'PUT') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 990,
            sku: 'SKU-CF',
            name: 'Custom Field Product',
            base_variant_id: 991,
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
        sku: 'SKU-CF',
        source_sku: 'SKU-CF',
        vendor_product_id: 'P-CF',
        name: 'Custom Field Product',
        gtin: '00011122233353',
        description: 'Updated',
        price: 12,
        cost_price: 9,
        custom_fields: [
          { name: 'vendor_endpoint', value: 'ProductData' },
          { name: 'source', value: 'vendor-api' },
        ],
      },
    });

    expect(result.action).toBe('update');
    expect(productPayload).toEqual(
      expect.not.objectContaining({
        custom_fields: expect.anything(),
      }),
    );
  });

  test('syncs related vendor product ids into a dedicated custom field on existing products', async () => {
    let customFieldBody: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233364')) {
        return {
          data: [
            {
              id: 992,
              sku: 'SKU-RELATED-CF',
              name: 'Related Custom Field Product',
              upc: '00011122233364',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/992') && method === 'PUT') {
        return {
          data: {
            id: 992,
            sku: 'SKU-RELATED-CF',
            name: 'Related Custom Field Product',
            base_variant_id: 993,
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

      if (url.endsWith('/custom-fields?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/custom-fields') && method === 'POST') {
        customFieldBody = JSON.parse(String(options.body));
        return {
          data: {
            id: 7001,
            ...customFieldBody,
          },
        };
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
        sku: 'SKU-RELATED-CF',
        source_sku: 'SKU-RELATED-CF',
        vendor_product_id: 'P-RELATED-CF',
        name: 'Related Custom Field Product',
        gtin: '00011122233364',
        description: 'Updated',
        price: 12,
        cost_price: 9,
        related_vendor_product_ids: ['PROD-2', 'PROD-3', 'PROD-2'],
      },
    });

    expect(result.action).toBe('update');
    expect(customFieldBody).toEqual({
      name: 'related_vendor_product_ids',
      value: 'PROD-2,PROD-3',
    });
  });

  test('creates new products with visibility disabled initially', async () => {
    let productPayload: Record<string, unknown> | undefined;
    const modifierPostBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-NEW')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=New%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 1200,
            sku: 'SKU-NEW',
            name: 'New Product',
            base_variant_id: 1201,
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
        modifierPostBodies.push(JSON.parse(String(options.body)));
        return { data: { id: modifierPostBodies.length } };
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
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-NEW',
        source_sku: 'SKU-NEW',
        vendor_product_id: 'P-NEW',
        name: 'New Product',
        description: 'Newly created',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('create');
    expect(productPayload?.is_visible).toBe(false);
    expect(modifierPostBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display_name: 'vendor_name',
          option_values: expect.arrayContaining([
            expect.objectContaining({
              label: 'PCNA',
            }),
          ]),
        }),
      ]),
    );
  });

  test('sends quantity_max as 0 for open-ended BigCommerce bulk pricing rules', async () => {
    const bulkPricingBodies: Array<Record<string, unknown>> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-BULK-OPEN')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 1290,
            sku: 'SKU-BULK-OPEN',
            name: 'Bulk Product',
            base_variant_id: 1291,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        bulkPricingBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 8000 + bulkPricingBodies.length } };
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

    await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-BULK-OPEN',
        source_sku: 'SKU-BULK-OPEN',
        vendor_product_id: 'P-BULK-OPEN',
        name: 'Bulk Product',
        description: 'Updated',
        price: 12,
        cost_price: 9,
        bulk_pricing_rules: [
          {
            quantity_min: 10,
            type: 'price',
            amount: 8,
          },
          {
            quantity_min: 20,
            type: 'price',
            amount: 7,
          },
        ],
      },
    });

    expect(bulkPricingBodies).toEqual([
      expect.objectContaining({
        quantity_min: 10,
        quantity_max: 19,
      }),
      expect.objectContaining({
        quantity_min: 20,
        quantity_max: 0,
      }),
    ]);
    expect(productPayload).not.toHaveProperty('bulk_pricing_rules');
  });

  test('dedupes identical normalized bulk pricing rules before BigCommerce create', async () => {
    const bulkPricingBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-BULK-DUPE')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Bulk%20Duplicate%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 901,
            sku: 'SKU-BULK-DUPE',
            name: 'Bulk Duplicate Product',
            base_variant_id: 902,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        bulkPricingBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 8000 + bulkPricingBodies.length } };
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

    await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-BULK-DUPE',
        source_sku: 'SKU-BULK-DUPE',
        vendor_product_id: 'P-BULK-DUPE',
        name: 'Bulk Duplicate Product',
        description: 'Updated',
        price: 12,
        cost_price: 9,
        bulk_pricing_rules: [
          {
            quantity_min: 50,
            quantity_max: 99,
            type: 'percent',
            amount: 14.23,
          },
          {
            quantity_min: 50,
            quantity_max: 99,
            type: 'percent',
            amount: 14.23,
          },
        ],
      },
    });

    expect(bulkPricingBodies).toEqual([
      {
        quantity_min: 50,
        quantity_max: 99,
        type: 'percent',
        amount: 14.23,
      },
    ]);
  });

  test('collapses conflicting same-range bulk pricing rules before BigCommerce create', async () => {
    const bulkPricingBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-BULK-CONFLICT')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Bulk%20Conflict%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 951,
            sku: 'SKU-BULK-CONFLICT',
            name: 'Bulk Conflict Product',
            base_variant_id: 952,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        bulkPricingBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 8100 + bulkPricingBodies.length } };
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

    await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-BULK-CONFLICT',
        source_sku: 'SKU-BULK-CONFLICT',
        vendor_product_id: 'P-BULK-CONFLICT',
        name: 'Bulk Conflict Product',
        description: 'Updated',
        price: 12,
        cost_price: 9,
        bulk_pricing_rules: [
          {
            quantity_min: 25,
            quantity_max: 49,
            type: 'percent',
            amount: 14.23,
          },
          {
            quantity_min: 25,
            quantity_max: 49,
            type: 'percent',
            amount: 16.45,
          },
        ],
      },
    });

    expect(bulkPricingBodies).toEqual([
      {
        quantity_min: 25,
        quantity_max: 49,
        type: 'percent',
        amount: 16.45,
      },
    ]);
  });

  test('uses created variant ids for price list records without sending a stale base variant for option-bearing products', async () => {
    const createdVariantBodies: Array<Record<string, unknown>> = [];
    const priceListInputs: Array<Record<string, unknown>> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-PRICE')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 1300,
            sku: String(productPayload?.sku ?? 'SKU-PRICE'),
            name: 'Priced Product',
            base_variant_id: 1301,
          },
        };
      }

      if (url.endsWith('/options?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/options') && method === 'POST') {
        return { data: { id: 2000 } };
      }

      if (url.endsWith('/variants?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/variants') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        createdVariantBodies.push(body);
        const id = createdVariantBodies.length === 1 ? 2101 : 2102;
        return { data: { id, sku: body.sku } };
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

    mockUpsertPriceListRecords.mockImplementation(async (input: Record<string, unknown>) => {
      priceListInputs.push(input);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-PRICE',
        source_sku: 'SKU-PRICE',
        vendor_product_id: 'P-PRICE',
        name: 'Priced Product',
        min_purchase_quantity: 12,
        max_purchase_quantity: 95,
        pricing_configuration: {
          currency: 'USD',
          parts: [
            {
              part_id: 'SKU-PRICE-BLK',
              default_part: true,
              price_tiers: [{ min_quantity: 12, quantity_max: 95, price: 10 }],
            },
            {
              part_id: 'SKU-PRICE-BLU',
              price_tiers: [{ min_quantity: 12, quantity_max: 95, price: 12 }],
            },
          ],
          locations: [],
          fob_points: [],
        },
        variants: [
          {
            sku: 'SKU-PRICE-BLK',
            source_sku: 'SKU-PRICE-BLK',
            part_id: 'SKU-PRICE-BLK',
            min_purchase_quantity: 12,
            max_purchase_quantity: 95,
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
          {
            sku: 'SKU-PRICE-BLU',
            source_sku: 'SKU-PRICE-BLU',
            part_id: 'SKU-PRICE-BLU',
            min_purchase_quantity: 12,
            max_purchase_quantity: 95,
            option_values: [{ option_display_name: 'Color', label: 'Blue' }],
          },
        ],
      },
    });

    expect(result.action).toBe('create');
    expect(productPayload).toEqual(
      expect.objectContaining({
        cost_price: 10,
        price: 14.29,
        min_purchase_quantity: 12,
        max_purchase_quantity: 95,
        mpn: 'P-PRICE',
        sku: expect.stringMatching(/^MMTMP\d{8}$/),
      }),
    );
    expect(createdVariantBodies).toHaveLength(2);
    expect(createdVariantBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: expect.stringMatching(/^MMTMP\d{8}-BLA$/),
          mpn: 'SKU-PRICE-BLK',
          min_purchase_quantity: 12,
          max_purchase_quantity: 95,
        }),
        expect.objectContaining({
          sku: expect.stringMatching(/^MMTMP\d{8}-BLU$/),
          mpn: 'SKU-PRICE-BLU',
          min_purchase_quantity: 12,
          max_purchase_quantity: 95,
        }),
      ]),
    );
    expect(mockSyncProjectedProductContract).toHaveBeenCalledWith(
      expect.objectContaining({
        productInternalMetafields: [
          {
            key: 'pricing_configuration_configuration',
            value: { contractVersion: '2026-03-22.1' },
          },
        ],
      }),
    );
    expect(mockUpsertPriceListRecords).toHaveBeenCalledTimes(1);
    expect(priceListInputs[0]).toEqual(
      expect.objectContaining({
        records: [
          expect.objectContaining({
            variant_id: 2101,
            price: 14.29,
            currency: 'USD',
          }),
          expect.objectContaining({
            variant_id: 2102,
            price: 17.14,
            currency: 'USD',
          }),
        ],
      }),
    );
  });

  test('updates only variant inventory for existing products', async () => {
    const inventoryAdjustmentBodies: Array<Record<string, unknown>> = [];
    let productPutBody: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233345')) {
        return {
          data: [
            {
              id: 1305,
              sku: 'SKU-INV-ONLY',
              name: 'Inventory Only Product',
              upc: '00011122233345',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/1305') && method === 'PUT') {
        productPutBody = JSON.parse(String(options.body));
        return {
          data: {
            id: 1305,
            sku: 'MM1305',
            name: 'Inventory Only Product',
            base_variant_id: 1306,
          },
        };
      }

      if (url.endsWith('/variants?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 2301,
              sku: 'MM1305-BLA',
              mpn: 'SKU-INV-ONLY-BLK',
              option_values: [{ option_display_name: 'Part', label: 'SKU-INV-ONLY-BLK' }],
            },
            {
              id: 2302,
              sku: 'MM1305-BLU',
              mpn: 'SKU-INV-ONLY-BLU',
              option_values: [],
            },
          ],
        };
      }

      if (url.endsWith('/inventory/adjustments/absolute') && method === 'PUT') {
        inventoryAdjustmentBodies.push(JSON.parse(String(options.body)));
        return { data: { items: [] } };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      inventoryOnlyForExistingProducts: true,
      product: {
        sku: 'SKU-INV-ONLY',
        source_sku: 'SKU-INV-ONLY',
        vendor_product_id: 'P-INV-ONLY',
        name: 'Inventory Only Product',
        gtin: '00011122233345',
        inventory_level: 19,
        media_assets: [
          {
            url: 'https://cdn.example.com/products/inventory only hero.jpg',
            media_type: 'Image',
            description: 'Hero image',
          },
          {
            url: 'https://cdn.example.com/products/inventory only black alt.jpg',
            media_type: 'Image',
            description: 'Black alternate image',
            part_id: 'SKU-INV-ONLY-BLK',
            class_type_array: [{ class_type_id: '1003', class_type_name: 'Alternate' }],
          },
          {
            url: 'https://cdn.example.com/products/inventory only black.jpg',
            media_type: 'Image',
            description: 'Black variant image',
            part_id: 'SKU-INV-ONLY-BLK',
            class_type_array: [{ class_type_id: '1006', class_type_name: 'Primary' }],
          },
        ],
        variants: [
          {
            sku: 'SKU-INV-ONLY-BLK',
            source_sku: 'SKU-INV-ONLY-BLK',
            part_id: 'SKU-INV-ONLY-BLK',
            inventory_level: 12,
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
          {
            sku: 'SKU-INV-ONLY-BLU',
            source_sku: 'SKU-INV-ONLY-BLU',
            part_id: 'SKU-INV-ONLY-BLU',
            inventory_level: 7,
            option_values: [{ option_display_name: 'Color', label: 'Blue' }],
          },
        ],
      },
    });

    expect(result.action).toBe('update');
    expect(productPutBody).toEqual({
      inventory_tracking: 'variant',
    });
    expect(result.inventory_sync_target).toEqual({
      tracking: 'variant',
      items: [
        { variant_id: 2301, quantity: 12 },
        { variant_id: 2302, quantity: 7 },
      ],
    });
    expect(mockUpsertPriceListRecords).not.toHaveBeenCalled();
    expect(mockSyncProjectedProductContract).not.toHaveBeenCalled();
    expect(mockRequestJson).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('/modifiers'),
      expect.anything(),
      expect.anything(),
    );
    expect(mockRequestJson).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('/custom-fields'),
      expect.anything(),
      expect.anything(),
    );
    expect(mockRequestJson).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('/images'),
      expect.anything(),
      expect.anything(),
    );

    await syncBigCommerceInventoryBatch({
      accessToken: 'token',
      storeHash: 'abc123',
      targets: [result.inventory_sync_target!],
    });

    expect(inventoryAdjustmentBodies).toEqual([
      {
        items: [
          { location_id: 1, variant_id: 2301, quantity: 12 },
          { location_id: 1, variant_id: 2302, quantity: 7 },
        ],
      },
    ]);
  expect(mockRequestJson).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('/inventory/locations'),
      expect.anything(),
      expect.anything(),
    );
  });

  test('manual full sync updates existing products with managed skus and contract media', async () => {
    let productPutBody: Record<string, unknown> | undefined;
    const variantPutBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233347')) {
        return {
          data: [
            {
              id: 1306,
              sku: '100063',
              name: 'Managed Existing Product',
              upc: '00011122233347',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1306') && method === 'PUT') {
        productPutBody = JSON.parse(String(options.body));
        return {
          data: {
            id: 1306,
            sku: 'MM1306',
            name: 'Managed Existing Product',
            base_variant_id: 1307,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'POST') {
        return { data: { id: 1 } };
      }

      if (url.endsWith('/options?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 1,
              display_name: 'Color',
              option_values: [{ id: 11, label: 'Black' }],
            },
          ],
        };
      }

      if (url.endsWith('/variants?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 2306,
              sku: '100063-001',
              mpn: '100063-001',
              option_values: [{ option_id: 1, id: 11, option_display_name: 'Color', label: 'Black' }],
            },
          ],
        };
      }

      if (url.endsWith('/variants/2306') && method === 'PUT') {
        variantPutBodies.push(JSON.parse(String(options.body)));
        return {
          data: {
            id: 2306,
            sku: 'MM1306-BLA',
          },
        };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        return { data: { id: 7001 } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/images') && method === 'POST') {
        return { data: { id: 8001 } };
      }

      if (url.endsWith('/variants/2306/image') && method === 'POST') {
        return { data: { id: 8101 } };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      vendorName: 'Gemline',
      defaultMarkupPercent: 30,
      product: {
        sku: '100063',
        source_sku: '100063',
        vendor_product_id: '100063',
        name: 'Managed Existing Product',
        gtin: '00011122233347',
        inventory_level: 14,
        media_assets: [
          {
            url: 'https://cdn.example.com/products/100063-hero.jpg',
            media_type: 'Image',
            description: 'Hero image',
            class_types: ['Primary'],
          },
        ],
        variants: [
          {
            sku: '100063-001',
            source_sku: '100063-001',
            part_id: '100063-001',
            inventory_level: 14,
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
        ],
      },
    });

    expect(result.action).toBe('update');
    expect(productPutBody).toEqual(
      expect.objectContaining({
        sku: 'MM1306',
        mpn: '100063',
      }),
    );
    expect(variantPutBodies).toEqual([
      expect.objectContaining({
        sku: 'MM1306-BLA',
        mpn: '100063-001',
      }),
    ]);
    expect(mockProjectBigCommerceProductContract).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'MM1306',
        variants: [
          expect.objectContaining({
            sku: 'MM1306-BLA',
            part_id: '100063-001',
          }),
        ],
        media_assets: [
          expect.objectContaining({
            url: 'https://cdn.example.com/products/100063-hero.jpg',
          }),
        ],
      }),
      expect.anything(),
    );
    expect(mockSyncProjectedProductContract).toHaveBeenCalledWith(
      expect.objectContaining({
        productDesignerDefaults: expect.objectContaining({
          sku: 'MM1306',
          media: expect.anything(),
          variantCatalog: [{ sku: 'MM1306-BLA' }],
        }),
      }),
    );
  });

  test('prefers GTIN lookup when checking for duplicate products', async () => {
    let productPutUrl: string | undefined;
    let gtinLookupCount = 0;
    let nameLookupCount = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233344')) {
        gtinLookupCount += 1;
        return {
          data: [
            {
              id: 1315,
              sku: 'OTHER-VENDOR-SKU',
              name: 'Storefront Product Title',
              upc: '00011122233344',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?sku=SKU-GTIN-ONLY')) {
        throw new Error('SKU duplicate lookup should not run when GTIN is present.');
      }

      if (url.endsWith('/catalog/products/1315') && method === 'PUT') {
        productPutUrl = url;
        return {
          data: {
            id: 1315,
            sku: 'OTHER-VENDOR-SKU',
            name: 'Storefront Product Title',
            upc: '00011122233344',
            base_variant_id: 1316,
          },
        };
      }

      if (url.endsWith('/catalog/products/1315/variants?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1315/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 5315,
              display_name: 'vendor_id',
              option_values: [{ label: '22', sort_order: 0 }],
            },
            {
              id: 5316,
              display_name: 'duplicate',
              option_values: [{ label: 'false', sort_order: 0 }],
            },
            {
              id: 5317,
              display_name: 'product_cost_markup',
              option_values: [{ label: '30', sort_order: 0 }],
            },
          ],
        };
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
        sku: 'SKU-GTIN-ONLY',
        source_sku: 'SKU-GTIN-ONLY',
        vendor_product_id: 'P-GTIN-ONLY',
        name: 'GTIN Lookup Product',
        gtin: '00011122233344',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(productPutUrl).toContain('/catalog/products/1315');
    expect(gtinLookupCount).toBe(1);
    expect(nameLookupCount).toBe(0);
  });

  test('skips duplicate lookup entirely when GTIN is missing', async () => {
    let productPostBody: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-NO-GTIN')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=No%20GTIN%20Lookup%20Product')) {
        throw new Error('Name duplicate lookup should not run when GTIN is missing.');
      }

      if (url.includes('/catalog/products?upc=')) {
        throw new Error('GTIN duplicate lookup should not run when GTIN is missing.');
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productPostBody = JSON.parse(String(options.body));
        return {
          data: {
            id: 1316,
            sku: 'SKU-NO-GTIN',
            name: 'No GTIN Lookup Product',
            base_variant_id: 1317,
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
        return { data: { id: 5400 } };
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
        sku: 'SKU-NO-GTIN',
        source_sku: 'SKU-NO-GTIN',
        vendor_product_id: 'P-NO-GTIN',
        name: 'No GTIN Lookup Product',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('create');
    expect(productPostBody).toEqual(
      expect.objectContaining({
        sku: expect.stringMatching(/^MMTMP\d{8}$/),
        mpn: 'P-NO-GTIN',
      }),
    );
  });

  test('throws a partial upsert error when BigCommerce image sync fails', async () => {
    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-IMG-FAIL')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Image%20Failure%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 1701,
            sku: 'SKU-IMG-FAIL',
            name: 'Image Failure Product',
            base_variant_id: 1702,
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

      if (url.endsWith('/images') && method === 'POST') {
        throw new Error('Failed to create BigCommerce product image (422)');
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      upsertBigCommerceProduct({
        accessToken: 'token',
        storeHash: 'abc123',
        vendorId: 22,
        defaultMarkupPercent: 30,
        product: {
          sku: 'SKU-IMG-FAIL',
          source_sku: 'SKU-IMG-FAIL',
          vendor_product_id: 'P-IMG-FAIL',
          name: 'Image Failure Product',
          description: 'Image failure test',
          price: 10,
          cost_price: 8,
          weight: 0.25,
          media_assets: [
            {
              url: 'https://cdn.example.com/products/failure image.jpg',
              media_type: 'Image',
              description: 'Failure image',
            },
          ],
        },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: 'Failed to create BigCommerce product image (422)',
        partial_upsert_result: expect.objectContaining({
          product: expect.objectContaining({
            id: 1701,
          }),
        }),
      }),
    );
  });

  test('skips unreachable remote image URLs instead of failing the sync', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const variantImageBodies: Array<Record<string, unknown>> = [];

    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockImplementation(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('missing-part.jpg')) {
          return {
            ok: false,
            status: 404,
            headers: {
              get: (name: string) => {
                if (name.toLowerCase() === 'content-type') {
                  return 'image/gif';
                }
                return null;
              },
            },
            body: {
              cancel: jest.fn().mockResolvedValue(undefined),
            },
          } as unknown as Response;
        }

        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => {
              if (name.toLowerCase() === 'content-type') {
                return 'image/jpeg';
              }
              return null;
            },
          },
          body: {
            cancel: jest.fn().mockResolvedValue(undefined),
          },
        } as unknown as Response;
      },
    );

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233356')) {
        return {
          data: [
            {
              id: 2701,
              sku: 'SKU-BAD-REMOTE',
              name: 'Bad Remote Image Product',
              upc: '00011122233356',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/2701') && method === 'PUT') {
        return {
          data: {
            id: 2701,
            sku: 'SKU-BAD-REMOTE',
            name: 'Bad Remote Image Product',
          },
        };
      }

      if (url.endsWith('/catalog/products/2701/variants?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 2702,
              sku: 'SKU-BAD-REMOTE-BLK',
              option_values: [{ option_display_name: 'Color', label: 'Black' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/2701/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/2701/options?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 1,
              display_name: 'Color',
              option_values: [{ id: 11, label: 'Black' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/2701/variants/2702') && method === 'PUT') {
        return {
          data: {
            id: 2702,
            sku: 'MM2701-BLA',
            mpn: 'SKU-BAD-REMOTE-BLK',
          },
        };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 5701,
              display_name: 'vendor_id',
              option_values: [{ label: '22', sort_order: 0 }],
            },
            {
              id: 5703,
              display_name: 'duplicate',
              option_values: [{ label: 'false', sort_order: 0 }],
            },
            {
              id: 5704,
              display_name: 'product_cost_markup',
              option_values: [{ label: '30', sort_order: 0 }],
            },
          ],
        };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 3701 } };
      }

      if (url.endsWith('/variants/2702/image') && method === 'POST') {
        variantImageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 4701 } };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      upsertBigCommerceProduct({
        accessToken: 'token',
        storeHash: 'abc123',
        vendorId: 22,
        defaultMarkupPercent: 30,
        product: {
          sku: 'SKU-BAD-REMOTE',
          source_sku: 'SKU-BAD-REMOTE',
          vendor_product_id: 'P-BAD-REMOTE',
          name: 'Bad Remote Image Product',
          gtin: '00011122233356',
          media_assets: [
            {
              url: 'https://cdn.example.com/products/hero.jpg',
              media_type: 'Image',
              description: 'Hero image',
            },
            {
              url: 'https://cdn.example.com/products/missing-part.jpg',
              media_type: 'Image',
              description: 'Missing variant image',
              part_id: 'SKU-BAD-REMOTE-BLK',
              class_types: ['Primary'],
            },
          ],
          variants: [
            {
              sku: 'SKU-BAD-REMOTE-BLK',
              source_sku: 'SKU-BAD-REMOTE-BLK',
              part_id: 'SKU-BAD-REMOTE-BLK',
              option_values: [{ option_display_name: 'Color', label: 'Black' }],
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: 'update',
      }),
    );

    expect(imageBodies).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/hero.jpg',
      }),
    ]);
    expect(variantImageBodies).toEqual([]);
  });

  test('does not delete or recreate unchanged vendor-managed product images on rerun', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const deletedImageIds: number[] = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233357')) {
        return {
          data: [
            {
              id: 2801,
              sku: 'SKU-IDEMPOTENT-IMG',
              name: 'Idempotent Image Product',
              upc: '00011122233357',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/2801') && method === 'PUT') {
        return {
          data: {
            id: 2801,
            sku: 'SKU-IDEMPOTENT-IMG',
            name: 'Idempotent Image Product',
          },
        };
      }

      if (url.endsWith('/catalog/products/2801/variants?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/2801/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 5801,
              display_name: 'vendor_id',
              option_values: [{ label: '22', sort_order: 0 }],
            },
            {
              id: 5803,
              display_name: 'duplicate',
              option_values: [{ label: 'false', sort_order: 0 }],
            },
            {
              id: 5804,
              display_name: 'product_cost_markup',
              option_values: [{ label: '30', sort_order: 0 }],
            },
          ],
        };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 3801,
              description:
                'Hero image | {"classTypes":["Primary"]}',
              is_thumbnail: true,
            },
            {
              id: 3802,
              description:
                'Alt image | {}',
              is_thumbnail: false,
            },
          ],
        };
      }

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 3900 + imageBodies.length } };
      }

      if (url.match(/\/images\/\d+$/) && method === 'DELETE') {
        deletedImageIds.push(Number(url.split('/').pop()));
        return {};
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      upsertBigCommerceProduct({
        accessToken: 'token',
        storeHash: 'abc123',
        vendorId: 22,
        defaultMarkupPercent: 30,
        product: {
          sku: 'SKU-IDEMPOTENT-IMG',
          source_sku: 'SKU-IDEMPOTENT-IMG',
          vendor_product_id: 'P-IDEMPOTENT-IMG',
          name: 'Idempotent Image Product',
          gtin: '00011122233357',
          media_assets: [
            {
              url: 'https://cdn.example.com/products/hero.jpg',
              media_type: 'Image',
              description: 'Hero image',
              class_types: ['Primary'],
            },
            {
              url: 'https://cdn.example.com/products/alt.jpg',
              media_type: 'Image',
              description: 'Alt image',
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: 'update',
      }),
    );

    expect(imageBodies).toEqual([]);
    expect(deletedImageIds).toEqual([]);
  });

  test('does not churn vendor-managed images when legacy markers are missing resolved location names', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const deletedImageIds: number[] = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233346')) {
        return {
          data: [
            {
              id: 2851,
              sku: 'SKU-LEGACY-IMG',
              name: 'Legacy Image Product',
              upc: '00011122233346',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/2851') && method === 'PUT') {
        return {
          data: {
            id: 2851,
            sku: 'SKU-LEGACY-IMG',
            name: 'Legacy Image Product',
          },
        };
      }

      if (url.endsWith('/catalog/products/2851/variants?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/2851/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 5851,
              display_name: 'vendor_id',
              option_values: [{ label: '22', sort_order: 0 }],
            },
            {
              id: 5853,
              display_name: 'duplicate',
              option_values: [{ label: 'false', sort_order: 0 }],
            },
            {
              id: 5854,
              display_name: 'product_cost_markup',
              option_values: [{ label: '30', sort_order: 0 }],
            },
          ],
        };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 3851,
              description:
                'Hero image | mm_media:{"mediaType":"Image","url":"https://cdn.example.com/products/legacy-hero.jpg","locationIds":["LOC-FRONT"]}',
              is_thumbnail: true,
            },
          ],
        };
      }

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 3950 + imageBodies.length } };
      }

      if (url.match(/\/images\/\d+$/) && method === 'DELETE') {
        deletedImageIds.push(Number(url.split('/').pop()));
        return {};
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      upsertBigCommerceProduct({
        accessToken: 'token',
        storeHash: 'abc123',
        vendorId: 22,
        defaultMarkupPercent: 30,
        product: {
          sku: 'SKU-LEGACY-IMG',
          source_sku: 'SKU-LEGACY-IMG',
          vendor_product_id: 'P-LEGACY-IMG',
          name: 'Legacy Image Product',
          gtin: '00011122233346',
          pricing_configuration: {
            locations: [
              {
                location_id: 'LOC-FRONT',
                location_name: 'Front',
                decorations: [],
              },
            ],
            fob_points: [],
            parts: [],
          },
          media_assets: [
            {
              url: 'https://cdn.example.com/products/legacy-hero.jpg',
              media_type: 'Image',
              description: 'Hero image',
              location_ids: ['LOC-FRONT'],
              class_types: ['Primary'],
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: 'update',
      }),
    );

    expect(imageBodies).toEqual([]);
    expect(deletedImageIds).toEqual([]);
  });

  test('deletes only stale vendor-managed product images and creates only missing ones', async () => {
    const imageBodies: Array<Record<string, unknown>> = [];
    const deletedImageIds: number[] = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233358')) {
        return {
          data: [
            {
              id: 2901,
              sku: 'SKU-DIFF-IMG',
              name: 'Diff Image Product',
              upc: '00011122233358',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/2901') && method === 'PUT') {
        return {
          data: {
            id: 2901,
            sku: 'SKU-DIFF-IMG',
            name: 'Diff Image Product',
          },
        };
      }

      if (url.endsWith('/catalog/products/2901/variants?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/2901/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 5901,
              display_name: 'vendor_id',
              option_values: [{ label: '22', sort_order: 0 }],
            },
            {
              id: 5903,
              display_name: 'duplicate',
              option_values: [{ label: 'false', sort_order: 0 }],
            },
            {
              id: 5904,
              display_name: 'product_cost_markup',
              option_values: [{ label: '30', sort_order: 0 }],
            },
          ],
        };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 3901,
              description:
                'Hero image | {"classTypes":["Primary"]}',
              is_thumbnail: true,
            },
            {
              id: 3902,
              description:
                'Retired image | {}',
              is_thumbnail: false,
            },
          ],
        };
      }

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 4900 + imageBodies.length } };
      }

      if (url.match(/\/images\/\d+$/) && method === 'DELETE') {
        deletedImageIds.push(Number(url.split('/').pop()));
        return {};
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      upsertBigCommerceProduct({
        accessToken: 'token',
        storeHash: 'abc123',
        vendorId: 22,
        defaultMarkupPercent: 30,
        product: {
          sku: 'SKU-DIFF-IMG',
          source_sku: 'SKU-DIFF-IMG',
          vendor_product_id: 'P-DIFF-IMG',
          name: 'Diff Image Product',
          gtin: '00011122233358',
          media_assets: [
            {
              url: 'https://cdn.example.com/products/hero.jpg',
              media_type: 'Image',
              description: 'Hero image',
              class_types: ['Primary'],
            },
            {
              url: 'https://cdn.example.com/products/new.jpg',
              media_type: 'Image',
              description: 'New image',
            },
          ],
        },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        action: 'update',
      }),
    );

    expect(imageBodies).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/new.jpg',
      }),
    ]);
    expect(deletedImageIds).toEqual([3902]);
  });

  test('creates inventory sync targets instead of sending quantity through the catalog product payload', async () => {
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-INV-CREATE')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?upc=00011122233344')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Inventory%20Create%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 1401,
            sku: 'SKU-INV-CREATE',
            name: 'Inventory Create Product',
            base_variant_id: 1402,
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

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-INV-CREATE',
        source_sku: 'SKU-INV-CREATE',
        vendor_product_id: 'P-INV-CREATE',
        name: 'Inventory Create Product',
        gtin: '00011122233344',
        inventory_level: 9,
      },
    });

    expect(productPayload).toEqual(
      expect.objectContaining({
        inventory_tracking: 'product',
        upc: '00011122233344',
      }),
    );
    expect(productPayload).not.toEqual(
      expect.objectContaining({
        inventory_level: expect.anything(),
      }),
    );
    expect(result.inventory_sync_target).toEqual({
      tracking: 'product',
      items: [{ product_id: 1401, quantity: 9 }],
    });
  });

  test('creates variants using BigCommerce option and option value ids after ensuring options exist', async () => {
    const createdVariantBodies: Array<Record<string, unknown>> = [];
    let optionListReads = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-VARIANT-IDS')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Variant%20Id%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        return {
          data: {
            id: 1310,
            sku: String(body.sku),
            name: 'Variant Id Product',
            base_variant_id: 1311,
          },
        };
      }

      if (url.endsWith('/options?limit=250') && method === 'GET') {
        optionListReads += 1;
        if (optionListReads === 1) {
          return { data: [] };
        }
        return {
          data: [
            {
              id: 500,
              display_name: 'Color',
              option_values: [
                { id: 501, label: 'Black' },
                { id: 502, label: 'Blue' },
              ],
            },
          ],
        };
      }

      if (url.endsWith('/options') && method === 'POST') {
        return { data: { id: 500 } };
      }

      if (url.endsWith('/variants?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/variants') && method === 'POST') {
        createdVariantBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 2200 + createdVariantBodies.length } };
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

    await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-VARIANT-IDS',
        source_sku: 'SKU-VARIANT-IDS',
        vendor_product_id: 'P-VARIANT-IDS',
        name: 'Variant Id Product',
        pricing_configuration: {
          currency: 'USD',
          parts: [
            {
              part_id: 'SKU-VARIANT-IDS-BLK',
              default_part: true,
              price_tiers: [{ min_quantity: 1, price: 10 }],
            },
            {
              part_id: 'SKU-VARIANT-IDS-BLU',
              price_tiers: [{ min_quantity: 1, price: 10 }],
            },
          ],
          locations: [],
          fob_points: [],
        },
        variants: [
          {
            sku: 'SKU-VARIANT-IDS-BLK',
            source_sku: 'SKU-VARIANT-IDS-BLK',
            part_id: 'SKU-VARIANT-IDS-BLK',
            gtin: '00011122233344',
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
          {
            sku: 'SKU-VARIANT-IDS-BLU',
            source_sku: 'SKU-VARIANT-IDS-BLU',
            part_id: 'SKU-VARIANT-IDS-BLU',
            gtin: '00011122233351',
            option_values: [{ option_display_name: 'Color', label: 'Blue' }],
          },
        ],
      },
    });

    expect(optionListReads).toBeGreaterThanOrEqual(2);
    expect(createdVariantBodies).toEqual([
      expect.objectContaining({
        sku: expect.stringMatching(/^MMTMP\d{8}-BLA$/),
        mpn: 'SKU-VARIANT-IDS-BLK',
        upc: '00011122233344',
        option_values: [{ option_id: 500, id: 501 }],
      }),
      expect.objectContaining({
        sku: expect.stringMatching(/^MMTMP\d{8}-BLU$/),
        mpn: 'SKU-VARIANT-IDS-BLU',
        upc: '00011122233351',
        option_values: [{ option_id: 500, id: 502 }],
      }),
    ]);
  });

  test('reuses the existing variant when BigCommerce reports duplicate option values on create', async () => {
    const variantPutBodies: Array<Record<string, unknown>> = [];
    let variantListReads = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-VARIANT-CONFLICT')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        return {
          data: {
            id: 1320,
            sku: String(body.sku),
            name: 'Variant Conflict Product',
            base_variant_id: 1321,
          },
        };
      }

      if (url.endsWith('/options?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 510,
              display_name: 'Color',
              option_values: [{ id: 511, label: 'Black' }],
            },
          ],
        };
      }

      if (url.endsWith('/variants?limit=250') && method === 'GET') {
        variantListReads += 1;
        if (variantListReads === 1) {
          return { data: [] };
        }
        return {
          data: [
            {
              id: 2210,
              sku: 'SKU-VARIANT-CONFLICT-BLK',
              option_values: [{ option_id: 510, id: 511 }],
            },
          ],
        };
      }

      if (url.endsWith('/variants') && method === 'POST') {
        throw new Error(
          'Failed to create BigCommerce variant (409): {"status":409,"code":22010,"title":"Variant with the same option values set exists","errors":{"option_values":"Variant with the same option values set exists"}}',
        );
      }

      if (url.endsWith('/variants/2210') && method === 'PUT') {
        variantPutBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 2210, sku: 'SKU-VARIANT-CONFLICT-BLK' } };
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
        sku: 'SKU-VARIANT-CONFLICT',
        source_sku: 'SKU-VARIANT-CONFLICT',
        vendor_product_id: 'P-VARIANT-CONFLICT',
        name: 'Variant Conflict Product',
        pricing_configuration: {
          currency: 'USD',
          parts: [
            {
              part_id: 'SKU-VARIANT-CONFLICT-BLK',
              default_part: true,
              price_tiers: [{ min_quantity: 1, price: 10 }],
            },
          ],
          locations: [],
          fob_points: [],
        },
        variants: [
          {
            sku: 'SKU-VARIANT-CONFLICT-BLK',
            source_sku: 'SKU-VARIANT-CONFLICT-BLK',
            part_id: 'SKU-VARIANT-CONFLICT-BLK',
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
        ],
      },
    });

    expect(result.action).toBe('create');
    expect(variantPutBodies).toEqual([
      expect.objectContaining({
        sku: expect.stringMatching(/^MMTMP\d{8}-BLA$/),
        mpn: 'SKU-VARIANT-CONFLICT-BLK',
        price: 14.29,
        option_values: [{ option_id: 510, id: 511 }],
      }),
    ]);
  });

  test('updates modifier values through dedicated modifier-value endpoints', async () => {
    const modifierValueUpdateBodies: Array<Record<string, unknown>> = [];
    const modifierValueUpdateUrls: string[] = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233360')) {
        return {
          data: [
            {
              id: 1400,
              sku: 'SKU-MOD',
              name: 'Modifier Product',
              upc: '00011122233360',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1400') && method === 'PUT') {
        return {
          data: {
            id: 1400,
            sku: 'SKU-MOD',
            name: 'Modifier Product',
            base_variant_id: 1401,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            { id: 5001, display_name: 'vendor_id' },
            { id: 5002, display_name: 'vendor_name' },
            { id: 5003, display_name: 'duplicate' },
            { id: 5004, display_name: 'product_cost_markup' },
          ],
        };
      }

      if (url.endsWith('/modifiers/5001/values?limit=250') && method === 'GET') {
        return { data: [{ id: 5101, label: '21', sort_order: 0, is_default: true }] };
      }

      if (url.endsWith('/modifiers/5002/values?limit=250') && method === 'GET') {
        return { data: [{ id: 5102, label: 'Gemline', sort_order: 0, is_default: true }] };
      }

      if (url.endsWith('/modifiers/5003/values?limit=250') && method === 'GET') {
        return { data: [{ id: 5103, label: 'true', sort_order: 0, is_default: true }] };
      }

      if (url.endsWith('/modifiers/5004/values?limit=250') && method === 'GET') {
        return { data: [{ id: 5104, label: '25', sort_order: 0, is_default: true }] };
      }

      if (url.match(/\/modifiers\/\d+\/values\/\d+$/) && method === 'PUT') {
        modifierValueUpdateUrls.push(url);
        modifierValueUpdateBodies.push(JSON.parse(String(options.body)));
        return { data: { id: Number(url.split('/').pop()) } };
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
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD',
        source_sku: 'SKU-MOD',
        vendor_product_id: 'P-MOD',
        name: 'Modifier Product',
        gtin: '00011122233360',
        description: 'Updated',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(modifierValueUpdateUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/modifiers/5001/values/5101'),
        expect.stringContaining('/modifiers/5002/values/5102'),
        expect.stringContaining('/modifiers/5003/values/5103'),
        expect.stringContaining('/modifiers/5004/values/5104'),
      ]),
    );
    expect(modifierValueUpdateBodies).toHaveLength(4);
    expect(modifierValueUpdateBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'PCNA',
          is_default: true,
        }),
        expect.objectContaining({
          label: '30',
          is_default: true,
        }),
      ]),
    );
  });

  test('creates products without embedded variants and retries conflicting variant skus with a vendor suffix', async () => {
    let productCreateBody: Record<string, unknown> | undefined;
    const variantCreateBodies: Array<Record<string, unknown>> = [];
    let firstManagedVariantSku: string | undefined;
    let optionListCallCount = 0;
    let variantListCallCount = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233370')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        productCreateBody = JSON.parse(String(options.body));
        return {
          data: {
            id: 1700,
            sku: String(productCreateBody?.sku ?? 'SKU-PARENT'),
            name: 'Variant Conflict Parent',
            base_variant_id: 1701,
          },
        };
      }

      if (url.endsWith('/catalog/products/1700/options?limit=250') && method === 'GET') {
        optionListCallCount += 1;
        if (optionListCallCount === 1) {
          return { data: [] };
        }

        return {
          data: [
            {
              id: 610,
              display_name: 'Color',
              option_values: [{ id: 611, label: 'Blue' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/1700/options') && method === 'POST') {
        return { data: { id: 610 } };
      }

      if (url.endsWith('/catalog/products/1700/variants?limit=250') && method === 'GET') {
        variantListCallCount += 1;
        if (variantListCallCount === 1) {
          return { data: [] };
        }

        return {
          data: [
            {
              id: 1702,
              sku: `${firstManagedVariantSku}__v22`,
              option_values: [{ option_id: 610, id: 611 }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/products/1700/variants') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        variantCreateBodies.push(body);

        if (!firstManagedVariantSku) {
          firstManagedVariantSku = String(body.sku);
          expect(firstManagedVariantSku).toMatch(/^MMTMP\d{8}-BLU$/);
          throw new Error(
            `Failed to create BigCommerce variant (409): {"status":409,"code":22003,"title":"Sku ${firstManagedVariantSku} is not unique","errors":{"sku":"Sku ${firstManagedVariantSku} is not unique"}}`,
          );
        }

        if (body.sku === `${firstManagedVariantSku}__v22`) {
          return {
            data: {
              id: 1702,
              sku: `${firstManagedVariantSku}__v22`,
            },
          };
        }
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
        sku: 'SKU-PARENT',
        source_sku: 'SKU-PARENT',
        vendor_product_id: 'PARENT-1',
        name: 'Variant Conflict Parent',
        gtin: '00011122233370',
        price: 12,
        cost_price: 9,
        variants: [
          {
            sku: 'SKU-PARENT-001',
            source_sku: 'SKU-PARENT-001',
            part_id: 'SKU-PARENT-001',
            price: 12,
            cost_price: 9,
            option_values: [{ option_display_name: 'Color', label: 'Blue' }],
          },
        ],
      },
    });

    expect(result.action).toBe('create');
    expect(productCreateBody).toEqual(
      expect.not.objectContaining({
        variants: expect.anything(),
      }),
    );
    expect(productCreateBody).toEqual(
      expect.objectContaining({
        sku: expect.stringMatching(/^MMTMP\d{8}$/),
        mpn: 'PARENT-1',
      }),
    );
    expect(variantCreateBodies.map(body => body.sku)).toEqual([
      firstManagedVariantSku,
      `${firstManagedVariantSku}__v22`,
    ]);
  });

  test('retries conflicting product skus when BigCommerce returns the duplicate sku wording', async () => {
    const productCreateBodies: Array<Record<string, unknown>> = [];
    let firstManagedProductSku: string | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233371')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/brands?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        productCreateBodies.push(body);

        if (!firstManagedProductSku) {
          firstManagedProductSku = String(body.sku);
          expect(firstManagedProductSku).toMatch(/^MMTMP\d{8}$/);
          throw new Error(
            'Failed to create BigCommerce product (409): {"status":409,"title":"The product sku is a duplicate","type":"https://developer.bigcommerce.com/api-docs/getting-started/api-status-codes","errors":{"sku":"The product sku is a duplicate"}}',
          );
        }

        if (body.sku === `${firstManagedProductSku}__v22`) {
          return {
            data: {
              id: 1750,
              sku: `${firstManagedProductSku}__v22`,
              name: 'Duplicate Retry Product',
              base_variant_id: 1751,
            },
          };
        }
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
        sku: 'SKU-DUPLICATE',
        source_sku: 'SKU-DUPLICATE',
        vendor_product_id: 'PARENT-DUPLICATE',
        name: 'Duplicate Retry Product',
        gtin: '00011122233371',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('create');
    expect(result.resolvedSku).toBe(`${firstManagedProductSku}__v22`);
    expect(productCreateBodies.map(body => body.sku)).toEqual([
      firstManagedProductSku,
      `${firstManagedProductSku}__v22`,
    ]);
  });

  test('updates the mapped BigCommerce product when GTIN is missing', async () => {
    const putUrls: string[] = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=')) {
        throw new Error('GTIN lookup should not run when GTIN is missing');
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1800') && method === 'PUT') {
        putUrls.push(url);
        return {
          data: {
            id: 1800,
            sku: 'SKU-MAPPED',
            name: 'Mapped Product',
            base_variant_id: 1801,
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
      existingBigCommerceProductId: 1800,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MAPPED',
        source_sku: 'SKU-MAPPED',
        vendor_product_id: 'P-MAPPED',
        name: 'Mapped Product',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(putUrls).toEqual(['https://api.bigcommerce.com/stores/abc123/v3/catalog/products/1800']);
  });

  test('skips modifier writes when the existing modifier already matches the desired values', async () => {
    let modifierWriteCount = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233347')) {
        return {
          data: [
            {
              id: 1450,
              sku: 'SKU-MOD-STABLE',
              name: 'Modifier Stable Product',
              upc: '00011122233347',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1450') && method === 'PUT') {
        return {
          data: {
            id: 1450,
            sku: 'SKU-MOD-STABLE',
            name: 'Modifier Stable Product',
            base_variant_id: 1451,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 5101,
              display_name: 'vendor_id',
              option_values: [{ label: '22', sort_order: 0 }],
            },
            {
              id: 5102,
              display_name: 'vendor_name',
              option_values: [{ label: 'PCNA', sort_order: 0 }],
            },
            {
              id: 5103,
              display_name: 'duplicate',
              option_values: [{ label: 'false', sort_order: 0 }],
            },
            {
              id: 5104,
              display_name: 'product_cost_markup',
              option_values: [{ label: '30', sort_order: 0 }],
            },
          ],
        };
      }

      if ((url.match(/\/modifiers\/\d+$/) && (method === 'PUT' || method === 'DELETE')) || (url.endsWith('/modifiers') && method === 'POST')) {
        modifierWriteCount += 1;
        return { data: { id: 9999 } };
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
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD-STABLE',
        source_sku: 'SKU-MOD-STABLE',
        vendor_product_id: 'P-MOD-STABLE',
        name: 'Modifier Stable Product',
        gtin: '00011122233347',
        description: 'Updated',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(modifierWriteCount).toBe(0);
  });

  test('does not recreate shared modifiers when values change on existing products', async () => {
    const modifierDeleteUrls: string[] = [];
    const modifierPostBodies: Array<Record<string, unknown>> = [];
    const modifierValueUpdateBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233361')) {
        return {
          data: [
            {
              id: 1500,
              sku: 'SKU-MOD-DUPE',
              name: 'Modifier Duplicate Product',
              upc: '00011122233361',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1500') && method === 'PUT') {
        return {
          data: {
            id: 1500,
            sku: 'SKU-MOD-DUPE',
            name: 'Modifier Duplicate Product',
            base_variant_id: 1501,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        return {
          data: [
            {
              id: 6001,
              display_name: 'vendor_id',
              option_values: [{ label: '21', sort_order: 0 }],
            },
            {
              id: 6002,
              display_name: 'vendor_name',
              option_values: [{ label: 'Gemline', sort_order: 0 }],
            },
            {
              id: 6003,
              display_name: 'duplicate',
              option_values: [{ label: 'true', sort_order: 0 }],
            },
            {
              id: 6004,
              display_name: 'product_cost_markup',
              option_values: [{ label: '25', sort_order: 0 }],
            },
          ],
        };
      }

      if (url.endsWith('/modifiers/6001/values?limit=250') && method === 'GET') {
        return { data: [{ id: 6101, label: '21', sort_order: 0, is_default: true }] };
      }

      if (url.endsWith('/modifiers/6002/values?limit=250') && method === 'GET') {
        return { data: [{ id: 6102, label: 'Gemline', sort_order: 0, is_default: true }] };
      }

      if (url.endsWith('/modifiers/6003/values?limit=250') && method === 'GET') {
        return { data: [{ id: 6103, label: 'true', sort_order: 0, is_default: true }] };
      }

      if (url.endsWith('/modifiers/6004/values?limit=250') && method === 'GET') {
        return { data: [{ id: 6104, label: '25', sort_order: 0, is_default: true }] };
      }

      if (url.match(/\/modifiers\/\d+$/) && method === 'DELETE') {
        modifierDeleteUrls.push(url);
        return {};
      }

      if (url.match(/\/modifiers\/\d+\/values\/\d+$/) && method === 'PUT') {
        modifierValueUpdateBodies.push(JSON.parse(String(options.body)));
        return { data: { id: Number(url.split('/').pop()) } };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        modifierPostBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 6200 + modifierPostBodies.length } };
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
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD-DUPE',
        source_sku: 'SKU-MOD-DUPE',
        vendor_product_id: 'P-MOD-DUPE',
        name: 'Modifier Duplicate Product',
        gtin: '00011122233361',
        description: 'Updated',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(modifierDeleteUrls).toEqual([]);
    expect(modifierPostBodies).toEqual([]);
    expect(modifierValueUpdateBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '22',
          sort_order: 0,
          is_default: true,
        }),
        expect.objectContaining({
          label: 'PCNA',
          sort_order: 0,
          is_default: true,
        }),
      ]),
    );
  });

  test('dedupes modifier create values when labels only differ by casing', async () => {
    const modifierPostBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-MOD-CASE')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Modifier%20Case%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 1600,
            sku: 'SKU-MOD-CASE',
            name: 'Modifier Case Product',
            base_variant_id: 1601,
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
        modifierPostBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 8000 + modifierPostBodies.length } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/videos?limit=250') && method === 'GET') {
        return { data: [] };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD-CASE',
        source_sku: 'SKU-MOD-CASE',
        vendor_product_id: 'P-MOD-CASE',
        name: 'Modifier Case Product',
        description: 'Modifier case test',
        price: 12,
        cost_price: 9,
        modifier_blueprint: {
          locations: [
            {
              location: 'Clip top left, - Centered On Body',
              methods: [],
            },
            {
              location: 'Clip top left, - Centered on Body',
              methods: [],
            },
            {
              location: 'Clip Right - Centered opposite clip on body',
              methods: [],
            },
            {
              location: 'Clip top RIGHT - Centered On Body',
              methods: [],
            },
            {
              location: 'Clip top RIGHT - Centered on Body',
              methods: [],
            },
          ],
          charges: [],
        },
      },
    });

    expect(modifierPostBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          display_name: 'Decoration Location',
          option_values: [
            {
              label: 'Clip top left, - Centered On Body',
              sort_order: 0,
              is_default: true,
            },
            {
              label: 'Clip Right - Centered opposite clip on body',
              sort_order: 1,
              is_default: false,
            },
            {
              label: 'Clip top RIGHT - Centered On Body',
              sort_order: 2,
              is_default: false,
            },
          ],
        }),
      ]),
    );
  });

  test('recovers when BigCommerce returns 500 creating a modifier but the modifier now exists', async () => {
    const modifierPostBodies: Array<Record<string, unknown>> = [];
    const modifierValuePutBodies: Array<Record<string, unknown>> = [];
    let modifierListCallCount = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-MOD-500-RECOVER')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Modifier%20500%20Recover%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 1700,
            sku: 'SKU-MOD-500-RECOVER',
            name: 'Modifier 500 Recover Product',
            base_variant_id: 1701,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        modifierListCallCount += 1;
        if (modifierListCallCount === 4) {
          return {
            data: [{ id: 9103, display_name: 'duplicate' }],
          };
        }
        return { data: [] };
      }

      if (url.endsWith('/modifiers/9103/values?limit=250') && method === 'GET') {
        return {
          data: [{ id: 9203, label: 'true', sort_order: 0, is_default: true }],
        };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        const payload = JSON.parse(String(options.body));
        modifierPostBodies.push(payload);
        if (payload.display_name === 'duplicate') {
          throw new Error('Failed to create product modifier (500): ');
        }
        return { data: { id: 9000 + modifierPostBodies.length } };
      }

      if (url.endsWith('/modifiers/9103/values/9203') && method === 'PUT') {
        modifierValuePutBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 9203 } };
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
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD-500-RECOVER',
        source_sku: 'SKU-MOD-500-RECOVER',
        vendor_product_id: 'P-MOD-500-RECOVER',
        name: 'Modifier 500 Recover Product',
        description: 'Modifier 500 recovery test',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('create');
    expect(modifierPostBodies.map(body => body.display_name)).toEqual([
      'vendor_id',
      'vendor_name',
      'duplicate',
      'product_cost_markup',
    ]);
    expect(modifierValuePutBodies).toEqual([
      {
        label: 'false',
        sort_order: 0,
        is_default: true,
      },
    ]);
  });

  test('retries modifier create after retryable BigCommerce 500 when the modifier is still absent', async () => {
    const modifierPostBodies: Array<Record<string, unknown>> = [];
    let modifierListCallCount = 0;
    let duplicatePostAttemptCount = 0;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-MOD-500-RETRY')) {
        return { data: [] };
      }

      if (url.includes('/catalog/products?name=Modifier%20500%20Retry%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products') && method === 'POST') {
        return {
          data: {
            id: 1750,
            sku: 'SKU-MOD-500-RETRY',
            name: 'Modifier 500 Retry Product',
            base_variant_id: 1751,
          },
        };
      }

      if (url.endsWith('/bulk-pricing-rules') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/modifiers?limit=250') && method === 'GET') {
        modifierListCallCount += 1;
        return { data: [] };
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        const payload = JSON.parse(String(options.body));
        modifierPostBodies.push(payload);
        if (payload.display_name === 'duplicate') {
          duplicatePostAttemptCount += 1;
          if (duplicatePostAttemptCount === 1) {
            throw new Error('Failed to create product modifier (500): ');
          }
        }
        return { data: { id: 9500 + modifierPostBodies.length } };
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
      vendorName: 'PCNA',
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD-500-RETRY',
        source_sku: 'SKU-MOD-500-RETRY',
        vendor_product_id: 'P-MOD-500-RETRY',
        name: 'Modifier 500 Retry Product',
        description: 'Modifier 500 retry test',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('create');
    expect(duplicatePostAttemptCount).toBe(2);
    expect(modifierPostBodies.map(body => body.display_name)).toEqual([
      'vendor_id',
      'vendor_name',
      'duplicate',
      'duplicate',
      'product_cost_markup',
    ]);
    expect(modifierListCallCount).toBe(5);
  });

  test('skips invalid vendor brand names instead of failing the product sync', async () => {
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?upc=00011122233362')) {
        return {
          data: [
            {
              id: 903,
              sku: 'SKU-3',
              name: 'Brand Product',
              upc: '00011122233362',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
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
        gtin: '00011122233362',
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

      if (url.includes('/catalog/products?upc=00011122233363')) {
        return {
          data: [
            {
              id: 904,
              sku: 'SKU-4',
              name: 'Long Brand Product',
              upc: '00011122233363',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
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
        gtin: '00011122233363',
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

describe('upsertRelatedProducts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updates related products through the v2 product related_products field', async () => {
    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url === 'https://api.bigcommerce.com/stores/storehash/v2/products/500' && method === 'GET') {
        return {
          id: 500,
          sku: 'MM500',
          name: 'Source Product',
          related_products: '501',
        };
      }

      if (url === 'https://api.bigcommerce.com/stores/storehash/v2/products/500' && method === 'PUT') {
        return {
          id: 500,
          sku: 'MM500',
          name: 'Source Product',
          related_products: '501,502',
        };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await upsertRelatedProducts({
      accessToken: 'token',
      storeHash: 'storehash',
      sourceProductId: 500,
      targetProductIds: [501, 502],
    });

    expect(mockRequestJson).toHaveBeenCalledWith(
      'token',
      'https://api.bigcommerce.com/stores/storehash/v2/products/500',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          related_products: '501,502',
        }),
      }),
      'Failed to update related products',
    );
  });
});
