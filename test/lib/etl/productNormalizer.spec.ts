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
                primaryColor: { Color: { colorName: 'Black' } },
                ApparelSize: { labelSize: 'M' },
              },
              {
                partId: 'P-100-BLU-L',
                primaryColor: { Color: { colorName: 'Blue' } },
                ApparelSize: { labelSize: 'L' },
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
    expect(result[0].variants).toHaveLength(2);
    expect(result[0].bulk_pricing_rules).toEqual([
      {
        quantity_min: 10,
        quantity_max: 49,
        type: 'price',
        amount: 22.5,
      },
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
