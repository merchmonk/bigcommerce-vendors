import {
  BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS,
  buildBigCommerceV3ProductImport,
} from '@lib/imports/bigcommerceV3ProductImport';
import type { NormalizedProduct } from '@lib/etl/productNormalizer';

describe('buildBigCommerceV3ProductImport', () => {
  test('creates v3 product and variant import rows that match the BigCommerce template shape', () => {
    const product: NormalizedProduct = {
      sku: 'STYLE-1',
      source_sku: 'STYLE-1',
      vendor_product_id: 'STYLE-1',
      name: 'Hydration Bottle',
      description: 'Bottle description',
      price: 10,
      cost_price: 10,
      weight: 0.32,
      brand_name: 'CamelBak',
      categories: ['Outdoor & Sport > Drinkware'],
      variants: [
        {
          sku: 'STYLE-1-BLK',
          source_sku: 'STYLE-1-BLK',
          part_id: 'STYLE-1-BLK',
          price: 10,
          cost_price: 10,
          weight: 0.32,
          color: 'Black',
          option_values: [{ option_display_name: 'Color', label: 'Black' }],
        },
        {
          sku: 'STYLE-1-WHT',
          source_sku: 'STYLE-1-WHT',
          part_id: 'STYLE-1-WHT',
          price: 12,
          cost_price: 12,
          weight: 0.32,
          color: 'White',
          option_values: [{ option_display_name: 'Color', label: 'White' }],
        },
      ],
      media_assets: [
        {
          url: 'https://cdn.example.com/style-1.jpg',
          media_type: 'Image',
          product_id: 'STYLE-1',
          description: 'Hero image',
          class_type_array: [{ class_type_id: '1006', class_type_name: 'Primary' }],
        },
        {
          url: 'https://cdn.example.com/style-1-black.jpg',
          media_type: 'Image',
          product_id: 'STYLE-1',
          part_id: 'STYLE-1-BLK',
          description: 'Black detail',
          class_type_array: [{ class_type_id: '902', class_type_name: 'Part Default Image' }],
        },
      ],
      custom_fields: [
        { name: 'vendor_endpoint', value: 'CSVImport' },
        { name: 'vendor_product_id', value: 'STYLE-1' },
      ],
      search_keywords: 'CamelBak, Drinkware',
      pricing_configuration: {
        parts: [
          {
            part_id: 'STYLE-1-BLK',
            price_tiers: [
              { min_quantity: 1, price: 10, currency: 'USD', price_type: 'Net', configuration_type: 'Blank' },
              { min_quantity: 1, price: 12, currency: 'USD', price_type: 'Net', configuration_type: 'Decorated' },
            ],
          },
          {
            part_id: 'STYLE-1-WHT',
            price_tiers: [
              { min_quantity: 1, price: 12, currency: 'USD', price_type: 'Net', configuration_type: 'Blank' },
              { min_quantity: 1, price: 14, currency: 'USD', price_type: 'Net', configuration_type: 'Decorated' },
            ],
          },
        ],
        locations: [],
        fob_points: [],
      },
      location_decoration_data: {
        dimensions: {
          width: 1.5,
          height: 2.5,
          depth: 3.5,
        },
      },
    };

    const result = buildBigCommerceV3ProductImport({
      products: [product],
      vendorId: 10,
      markupPercent: 30,
    });

    expect(BIGCOMMERCE_V3_PRODUCT_IMPORT_HEADERS.slice(0, 6)).toEqual([
      'Item',
      'ID',
      'Name',
      'Type',
      'SKU',
      'Options',
    ]);
    expect(result.rows).toHaveLength(5);
    expect(result.report).toEqual({
      product_count: 1,
      variant_row_count: 2,
      row_count: 5,
    });

    expect(result.rows[0]).toEqual(
      expect.objectContaining({
        Item: 'Product',
        Name: 'Hydration Bottle',
        Type: 'physical',
        'Inventory Tracking': 'variant',
        Categories: 'Outdoor & Sport/Drinkware',
        'Cost Price': '12.00',
        'Custom Fields': expect.stringContaining('"vendor_id"'),
        'Is Visible': 'FALSE',
        'Manufacturer Part Number': 'STYLE-1',
      }),
    );
    expect(result.rows[0].SKU).toMatch(/^MM/);

    expect(result.rows[1]).toEqual(
      expect.objectContaining({
        Item: 'Variant',
        Options: 'Type=Swatch|Name=Color|Value=Black',
        'Cost Price': '12.00',
        'Variant Image URL': 'https://cdn.example.com/style-1-black.jpg',
      }),
    );
    expect(result.rows[1].SKU).toMatch(/^MM.*BLA/);

    expect(result.rows[2]).toEqual(
      expect.objectContaining({
        Item: 'Variant',
        Options: 'Type=Swatch|Name=Color|Value=White',
        'Cost Price': '14.00',
      }),
    );
    expect(result.rows[2].SKU).toMatch(/^MM.*WHI/);

    expect(result.rows[3]).toEqual(
      expect.objectContaining({
        Item: 'Image',
        'Image URL (Import)': 'https://cdn.example.com/style-1.jpg',
        'Image is Thumbnail': 'TRUE',
        'Image Sort Order': '0',
      }),
    );
    expect(result.rows[3]['Image Description']).toBe('Hero image | {"classTypes":["Primary"]}');
  });
});
