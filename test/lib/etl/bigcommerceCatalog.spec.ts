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

import { syncBigCommerceInventoryBatch, upsertBigCommerceProduct } from '@lib/etl/bigcommerceCatalog';

describe('upsertBigCommerceProduct media sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReconcileProjectedPricingTargets.mockReturnValue({
      missing_variant_ids: [],
      extra_variant_ids: [],
    });
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
            class_types: ['Primary'],
          },
          {
            url: 'https://cdn.example.com/products/part black.jpg',
            media_type: 'Image',
            description: 'Black part image',
            part_id: 'PART-BLK',
            location_ids: ['LOC-FRONT'],
            decoration_ids: ['DEC-SCREEN'],
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
        is_thumbnail: true,
      }),
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/part%20black.jpg',
      }),
    ]);
    expect(imageBodies[0].description).toContain('mm_media:');
    expect(imageBodies[1].description).toContain('"partId":"PART-BLK"');
    expect(imageBodies[1].description).toContain('"locationIds":["LOC-FRONT"]');
    expect(imageBodies[1].description).toContain('"locationNames":["Front Pocket"]');
    expect(imageBodies[1].description).toContain('"decorationIds":["DEC-SCREEN"]');
    expect(imageBodies[1].description).toContain('"decorationNames":["Screen Print"]');
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
    (globalThis as { fetch?: jest.Mock }).fetch = jest.fn().mockResolvedValue({
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

  test('does not resend product custom fields on update', async () => {
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-CF')) {
        return {
          data: [
            {
              id: 990,
              sku: 'SKU-CF',
              name: 'Custom Field Product',
              custom_fields: [
                { name: 'vendor_id', value: '22' },
                { name: 'vendor_endpoint', value: 'ProductData' },
              ],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Custom%20Field%20Product')) {
        return { data: [] };
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

  test('creates new products with visibility disabled initially', async () => {
    let productPayload: Record<string, unknown> | undefined;

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
  });

  test('sends quantity_max as 0 for open-ended BigCommerce bulk pricing rules', async () => {
    const bulkPricingBodies: Array<Record<string, unknown>> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-BULK-OPEN')) {
        return {
          data: [
            {
              id: 1290,
              sku: 'SKU-BULK-OPEN',
              name: 'Bulk Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Bulk%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1290') && method === 'PUT') {
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

  test('uses created variant ids for price list records and includes the product base variant price', async () => {
    const createdVariantBodies: Array<Record<string, unknown>> = [];
    const priceListInputs: Array<Record<string, unknown>> = [];
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-PRICE')) {
        return {
          data: [
            {
              id: 1300,
              sku: 'SKU-PRICE',
              name: 'Priced Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Priced%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1300') && method === 'PUT') {
        productPayload = JSON.parse(String(options.body));
        return {
          data: {
            id: 1300,
            sku: 'SKU-PRICE',
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
        pricing_configuration: {
          currency: 'USD',
          parts: [
            {
              part_id: 'SKU-PRICE-BLK',
              default_part: true,
              price_tiers: [{ min_quantity: 1, price: 10 }],
            },
            {
              part_id: 'SKU-PRICE-BLU',
              price_tiers: [{ min_quantity: 1, price: 12 }],
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
            option_values: [{ option_display_name: 'Color', label: 'Black' }],
          },
          {
            sku: 'SKU-PRICE-BLU',
            source_sku: 'SKU-PRICE-BLU',
            part_id: 'SKU-PRICE-BLU',
            option_values: [{ option_display_name: 'Color', label: 'Blue' }],
          },
        ],
      },
    });

    expect(result.action).toBe('update');
    expect(productPayload).toEqual(
      expect.objectContaining({
        cost_price: 10,
        price: 13,
      }),
    );
    expect(createdVariantBodies).toHaveLength(2);
    expect(mockUpsertPriceListRecords).toHaveBeenCalledTimes(1);
    expect(priceListInputs[0]).toEqual(
      expect.objectContaining({
        records: expect.arrayContaining([
          expect.objectContaining({
            variant_id: 1301,
            price: 13,
            currency: 'USD',
          }),
          expect.objectContaining({
            variant_id: 2101,
            price: 13,
            currency: 'USD',
          }),
          expect.objectContaining({
            variant_id: 2102,
            price: 15.6,
            currency: 'USD',
          }),
        ]),
      }),
    );
  });

  test('updates only variant inventory for existing products', async () => {
    const inventoryAdjustmentBodies: Array<Record<string, unknown>> = [];
    const imageBodies: Array<Record<string, unknown>> = [];
    const variantImageBodies: Array<Record<string, unknown>> = [];
    let productPutBody: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-INV-ONLY')) {
        return {
          data: [
            {
              id: 1305,
              sku: 'SKU-INV-ONLY',
              name: 'Inventory Only Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Inventory%20Only%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1305') && method === 'PUT') {
        productPutBody = JSON.parse(String(options.body));
        return {
          data: {
            id: 1305,
            sku: 'SKU-INV-ONLY',
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
              sku: 'SKU-INV-ONLY-BLK-ALT',
              option_values: [{ option_display_name: 'Part', label: 'SKU-INV-ONLY-BLK' }],
            },
            {
              id: 2302,
              sku: 'SKU-INV-ONLY-BLU',
              option_values: [],
            },
          ],
        };
      }

      if (url.endsWith('/inventory/locations') && method === 'GET') {
        return {
          data: [
            {
              id: 2,
              enabled: true,
            },
          ],
        };
      }

      if (url.endsWith('/inventory/adjustments/absolute') && method === 'PUT') {
        inventoryAdjustmentBodies.push(JSON.parse(String(options.body)));
        return { data: { items: [] } };
      }

      if (url.endsWith('/images?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/images') && method === 'POST') {
        imageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 3301 } };
      }

      if (url.endsWith('/variants/2301/image') && method === 'POST') {
        variantImageBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 4301 } };
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    const result = await upsertBigCommerceProduct({
      accessToken: 'token',
      storeHash: 'abc123',
      vendorId: 22,
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-INV-ONLY',
        source_sku: 'SKU-INV-ONLY',
        vendor_product_id: 'P-INV-ONLY',
        name: 'Inventory Only Product',
        inventory_level: 19,
        media_assets: [
          {
            url: 'https://cdn.example.com/products/inventory only hero.jpg',
            media_type: 'Image',
            description: 'Hero image',
          },
          {
            url: 'https://cdn.example.com/products/inventory only black.jpg',
            media_type: 'Image',
            description: 'Black variant image',
            part_id: 'SKU-INV-ONLY-BLK',
            class_types: ['Primary'],
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
    expect(imageBodies).toEqual([
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/inventory%20only%20hero.jpg',
      }),
      expect.objectContaining({
        image_url: 'https://cdn.example.com/products/inventory%20only%20black.jpg',
      }),
    ]);
    expect(variantImageBodies).toEqual([
      {
        image_url: 'https://cdn.example.com/products/inventory%20only%20black.jpg',
      },
    ]);
    expect(result.inventory_sync_target).toEqual({
      tracking: 'variant',
      items: [
        { variant_id: 2301, quantity: 12 },
        { variant_id: 2302, quantity: 7 },
      ],
    });
    expect(mockUpsertPriceListRecords).not.toHaveBeenCalled();
    expect(mockSyncProjectedProductContract).not.toHaveBeenCalled();

    await syncBigCommerceInventoryBatch({
      accessToken: 'token',
      storeHash: 'abc123',
      targets: [result.inventory_sync_target!],
    });

    expect(inventoryAdjustmentBodies).toEqual([
      {
        items: [
          { location_id: 2, variant_id: 2301, quantity: 12 },
          { location_id: 2, variant_id: 2302, quantity: 7 },
        ],
      },
    ]);
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

  test('creates inventory sync targets instead of sending quantity through the catalog product payload', async () => {
    let productPayload: Record<string, unknown> | undefined;

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-INV-CREATE')) {
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
        return {
          data: {
            id: 1310,
            sku: 'SKU-VARIANT-IDS',
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
        sku: 'SKU-VARIANT-IDS-BLK',
        upc: '00011122233344',
        option_values: [{ option_id: 500, id: 501 }],
      }),
      expect.objectContaining({
        sku: 'SKU-VARIANT-IDS-BLU',
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
        return {
          data: [
            {
              id: 1320,
              sku: 'SKU-VARIANT-CONFLICT',
              name: 'Variant Conflict Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Variant%20Conflict%20Product')) {
        return { data: [] };
      }

      if (url.endsWith('/catalog/categories?limit=250') && method === 'GET') {
        return { data: [] };
      }

      if (url.endsWith('/catalog/products/1320') && method === 'PUT') {
        return {
          data: {
            id: 1320,
            sku: 'SKU-VARIANT-CONFLICT',
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

    expect(result.action).toBe('update');
    expect(variantPutBodies).toEqual([
      expect.objectContaining({
        sku: 'SKU-VARIANT-CONFLICT-BLK',
        option_values: [{ option_id: 510, id: 511 }],
      }),
    ]);
  });

  test('does not send modifier defaults on update', async () => {
    const modifierUpdateBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-MOD')) {
        return {
          data: [
            {
              id: 1400,
              sku: 'SKU-MOD',
              name: 'Modifier Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Modifier%20Product')) {
        return { data: [] };
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
            { id: 5002, display_name: 'duplicate' },
            { id: 5003, display_name: 'product_cost_markup' },
          ],
        };
      }

      if (url.match(/\/modifiers\/\d+$/) && method === 'PUT') {
        modifierUpdateBodies.push(JSON.parse(String(options.body)));
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
      defaultMarkupPercent: 30,
      product: {
        sku: 'SKU-MOD',
        source_sku: 'SKU-MOD',
        vendor_product_id: 'P-MOD',
        name: 'Modifier Product',
        description: 'Updated',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(modifierUpdateBodies).toHaveLength(3);
    expect(modifierUpdateBodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          option_values: expect.arrayContaining([
            expect.not.objectContaining({
              is_default: expect.anything(),
            }),
          ]),
        }),
      ]),
    );
  });

  test('recreates modifiers when BigCommerce rejects update payloads as duplicate labels', async () => {
    const modifierDeleteUrls: string[] = [];
    const modifierPostBodies: Array<Record<string, unknown>> = [];

    mockRequestJson.mockImplementation(async (_accessToken, url: string, options: RequestInit) => {
      const method = options.method ?? 'GET';

      if (url.includes('/catalog/products?sku=SKU-MOD-DUPE')) {
        return {
          data: [
            {
              id: 1500,
              sku: 'SKU-MOD-DUPE',
              name: 'Modifier Duplicate Product',
              custom_fields: [{ name: 'vendor_id', value: '22' }],
            },
          ],
        };
      }

      if (url.includes('/catalog/products?name=Modifier%20Duplicate%20Product')) {
        return { data: [] };
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
            { id: 6001, display_name: 'vendor_id' },
            { id: 6002, display_name: 'duplicate' },
            { id: 6003, display_name: 'product_cost_markup' },
          ],
        };
      }

      if (url.match(/\/modifiers\/\d+$/) && method === 'PUT') {
        throw new Error(
          'Failed to update product modifier (422): {"status":422,"title":"The option label: \\"6\\" value is already used on this option."}',
        );
      }

      if (url.match(/\/modifiers\/\d+$/) && method === 'DELETE') {
        modifierDeleteUrls.push(url);
        return {};
      }

      if (url.endsWith('/modifiers') && method === 'POST') {
        modifierPostBodies.push(JSON.parse(String(options.body)));
        return { data: { id: 7000 + modifierPostBodies.length } };
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
        sku: 'SKU-MOD-DUPE',
        source_sku: 'SKU-MOD-DUPE',
        vendor_product_id: 'P-MOD-DUPE',
        name: 'Modifier Duplicate Product',
        description: 'Updated',
        price: 12,
        cost_price: 9,
      },
    });

    expect(result.action).toBe('update');
    expect(modifierDeleteUrls).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/modifiers/6001'),
        expect.stringContaining('/modifiers/6002'),
        expect.stringContaining('/modifiers/6003'),
      ]),
    );
    expect(modifierPostBodies).toHaveLength(3);
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
