import {
  extractProductReferencesFromPayload,
  normalizeProductsFromEndpoint,
} from '@lib/etl/productNormalizer';

describe('normalizeProductsFromEndpoint', () => {
  test('extracts products from nested payloads and merges by SKU', () => {
    const payload = {
      Envelope: {
        Body: {
          items: [
            { SKU: 'A-1', Name: 'Alpha', Price: '3.5', quantityAvailable: '12' },
            { SKU: 'A-1', Description: 'duplicate row with more fields' },
            { SKU: 'B-2', ProductName: 'Bravo' },
          ],
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'ProductData',
      '2.0.0',
      'getProduct',
      payload,
      { custom_fields: [{ name: 'source', value: 'test' }] },
    );

    expect(result).toHaveLength(2);
    expect(result[0].sku).toBe('A-1');
    expect(result[0].price).toBe(3.5);
    expect(result[0].inventory_level).toBe(12);
    expect(result[0].custom_fields).toEqual(
      expect.arrayContaining([{ name: 'source', value: 'test' }]),
    );
  });

  test('extracts nested quantityAvailable values when normalizing generic endpoint payloads', () => {
    const payload = {
      Envelope: {
        Body: {
          items: [
            {
              SKU: 'A-1',
              Name: 'Alpha',
              quantityAvailable: {
                Quantity: {
                  uom: 'EA',
                  value: '12',
                },
              },
            },
          ],
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'Inventory',
      '2.0.0',
      'getInventoryLevels',
      payload,
    );

    expect(result).toHaveLength(1);
    expect(result[0].inventory_level).toBe(12);
  });

  test('normalizes ProductData getProduct response with variants, brand, categories, and bulk pricing', () => {
    const payload = {
      getProductResponse: {
        Product: {
          productId: 'P-100',
          productName: 'Performance Polo',
          description: ['Moisture-wicking polo shirt'],
          productBrand: 'Acme Brand',
          ProductCategoryArray: {
            ProductCategory: [{ category: 'Apparel', subCategory: 'Polos' }],
          },
          ProductPriceGroupArray: {
            ProductPriceGroup: [
              {
                ProductPriceArray: {
                  ProductPrice: [
                    { quantityMin: 1, quantityMax: 9, price: 24.99 },
                    { quantityMin: 10, quantityMax: 49, price: 22.5 },
                  ],
                },
                groupName: 'Default',
                currency: 'USD',
              },
            ],
          },
          ProductPartArray: {
            ProductPart: [
              {
                partId: 'P-100-BLK-M',
                gtin: '00011122233344',
                primaryColor: { Color: { colorName: 'Black' } },
                ApparelSize: { labelSize: 'M' },
                Dimension: {
                  weight: 0.75,
                  weightUom: 'LB',
                },
              },
              {
                partId: 'P-100-BLU-L',
                gtin: '00011122233351',
                primaryColor: { Color: { colorName: 'Blue' } },
                ApparelSize: { labelSize: 'L' },
                Dimension: {
                  weight: 12,
                  weightUom: 'OZ',
                },
              },
            ],
          },
          primaryImageUrl: 'https://cdn.example.com/polo.png',
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'ProductData',
      '2.0.0',
      'getProduct',
      payload,
    );

    expect(result).toHaveLength(1);
    expect(result[0].vendor_product_id).toBe('P-100');
    expect(result[0].brand_name).toBe('Acme Brand');
    expect(result[0].categories).toEqual(['Apparel > Polos']);
    expect(result[0].weight).toBeCloseTo(0.75);
    expect(result[0].gtin).toBe('00011122233344');
    expect(result[0].variants).toHaveLength(2);
    expect(result[0].variants?.[0].gtin).toBe('00011122233344');
    expect(result[0].variants?.[1].gtin).toBe('00011122233351');
    expect(result[0].variants?.[0].weight).toBeCloseTo(0.75);
    expect(result[0].variants?.[1].weight).toBeCloseTo(0.75);
    expect(result[0].bulk_pricing_rules).toEqual([
      {
        quantity_min: 10,
        quantity_max: 49,
        type: 'price',
        amount: 22.5,
      },
    ]);
  });

  test('adds a Part option when vendor parts would otherwise collide on the same option combination', () => {
    const payload = {
      getProductResponse: {
        Product: {
          productId: 'P-200',
          productName: 'Duplicate Color Product',
          ProductPartArray: {
            ProductPart: [
              {
                partId: 'P-200-BLK-1',
                primaryColor: { Color: { colorName: 'Black' } },
              },
              {
                partId: 'P-200-BLK-2',
                primaryColor: { Color: { colorName: 'Black' } },
              },
            ],
          },
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'ProductData',
      '2.0.0',
      'getProduct',
      payload,
    );

    expect(result).toHaveLength(1);
    expect(result[0].variants).toEqual([
      expect.objectContaining({
        sku: 'P-200-BLK-1',
        option_values: [
          { option_display_name: 'Color', label: 'Black' },
          { option_display_name: 'Part', label: 'P-200-BLK-1' },
        ],
      }),
      expect.objectContaining({
        sku: 'P-200-BLK-2',
        option_values: [
          { option_display_name: 'Color', label: 'Black' },
          { option_display_name: 'Part', label: 'P-200-BLK-2' },
        ],
      }),
    ]);
  });

  test('prefers hierarchical merchandising categories over faceted vendor tags', () => {
    const payload = {
      getProductResponse: {
        Product: {
          productId: 'G8064',
          productName: 'Preston eco keyring',
          ProductCategoryArray: {
            ProductCategory: [
              { category: 'ECO' },
              { category: 'Business accessories', subCategory: 'Key rings' },
              { category: 'Travel Accessories' },
              { category: 'MADE IN CHINA' },
              { category: 'Products manufactured by social compliant factories' },
            ],
          },
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'ProductData',
      '2.0.0',
      'getProduct',
      payload,
    );

    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual(['Business accessories > Key rings']);
  });

  test('omits obvious non-taxonomy vendor tags from flat product categories', () => {
    const payload = {
      getProductResponse: {
        Product: {
          productId: 'BG207',
          productName: 'Weekender bag',
          ProductCategoryArray: {
            ProductCategory: [
              { category: 'BackPack' },
              { category: 'LUGGAGE' },
              { category: 'HYBRID' },
              { category: 'Bags' },
              { category: 'MADE IN CHINA' },
              { category: 'Duffle' },
              { category: 'Branding solutions' },
              { category: 'LUGGAGE WEEKENDERS' },
              { category: 'New Items' },
            ],
          },
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'ProductData',
      '2.0.0',
      'getProduct',
      payload,
    );

    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual([
      'BackPack',
      'LUGGAGE',
      'HYBRID',
      'Bags',
      'Duffle',
      'LUGGAGE WEEKENDERS',
      'New Items',
    ]);
  });

  test('extracts product references from ProductData discovery responses', () => {
    const payload = {
      getProductSellableResponse: {
        ProductSellableArray: {
          ProductSellable: [
            { productId: 'P-1', partId: 'P-1-RED' },
            { productId: 'P-1', partId: 'P-1-RED' },
            { productId: 'P-2' },
          ],
        },
      },
    };

    const refs = extractProductReferencesFromPayload(payload);
    expect(refs).toEqual([
      { productId: 'P-1', partId: 'P-1-RED' },
      { productId: 'P-2' },
    ]);
  });
});
