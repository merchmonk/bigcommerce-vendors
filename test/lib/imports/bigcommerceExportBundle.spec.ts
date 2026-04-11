import {
  BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS,
  buildBigCommerceExportBundle,
} from '@lib/imports/bigcommerceExportBundle';
import type { NormalizedProduct } from '@lib/etl/productNormalizer';

const productHeaders = [
  'Item Type',
  'Product SKU',
  'Product Name',
  'Category String',
  'Weight',
  'Description',
  'Price',
  'Retail Price',
  'Sale Price',
  'Cost Price',
  'Calculated Price',
  'Stock Level',
  'Low Stock Level',
  'Track Inventory',
  'Product Inventoried',
  'Sort Order',
  'Product Not Visible',
  'Product Visible',
  'Allow Purchases',
  'Free Shipping',
  'Fixed Shipping Price',
  'Brand + Name',
  'Brand',
  'Product Condition',
  'Show Product Condition',
  'Product UPC/EAN',
  'Product Tax Class',
  'Search Keywords',
  'Option Set',
  'Option Set Align',
  'Stop Processing Rules',
  'Product Custom Fields',
  'Product Image File',
  'Product Image URL',
  'Product Image Description',
  'Product Image Is Thumbnail',
  'Product Image Index',
  'Product Type',
  'Event Date Required',
  'Event Date Is Limited',
];

const skuHeaders = [
  'Product SKU',
  'Product UPC/EAN',
  'Stock Level',
  'Product Width',
  'Product Height',
  'Product Depth',
  'Free Shipping',
  'Fixed Shipping Cost',
  'Product Weight',
];

describe('buildBigCommerceExportBundle', () => {
  test('creates product rows, sku rows, and metafield rows from a normalized variant product', () => {
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
          url: 'https://cdn.example.com/style-1-black.jpg',
          media_type: 'Image',
          product_id: 'STYLE-1',
          part_id: 'STYLE-1-BLK',
          description: 'Black image',
          class_type_array: [{ class_type_id: '902', class_type_name: 'Part Default Image' }],
        },
        {
          url: 'https://cdn.example.com/style-1-white.jpg',
          media_type: 'Image',
          product_id: 'STYLE-1',
          part_id: 'STYLE-1-WHT',
          class_type_array: [{ class_type_id: '1006', class_type_name: 'Primary' }],
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
    };

    const result = buildBigCommerceExportBundle({
      productsTemplateHeaders: productHeaders,
      skuTemplateHeaders: skuHeaders,
      products: [product],
      vendorId: 10,
      markupPercent: 30,
    });

    expect(result.productRows).toHaveLength(6);
    expect(result.skuRows).toHaveLength(2);
    expect(result.productMetafieldRows).toHaveLength(2);
    expect(result.variantMetafieldRows).toHaveLength(0);

    expect(result.productRows[0]).toEqual(
      expect.objectContaining({
        'Item Type': 'Product',
        'Product SKU': 'STYLE-1',
        'Product Name': 'Hydration Bottle',
        'Category String': 'Outdoor & Sport/Drinkware',
        Price: '15.60',
        'Cost Price': '12.00',
        'Track Inventory': 'by option',
        'Product Not Visible': '1',
        'Product Visible': '0',
        'Product Image URL': 'https://cdn.example.com/style-1-black.jpg',
        'Product Image Is Thumbnail': '1',
      }),
    );

    expect(result.productRows[2]).toEqual(
      expect.objectContaining({
        'Item Type': '  SKU',
        'Product SKU': 'STYLE-1-BLK',
        'Product Name': '[RB]Color=Black',
        Price: '15.60',
        'Cost Price': '12.00',
      }),
    );

    expect(result.productRows[3]).toEqual(
      expect.objectContaining({
        'Item Type': '  Rule',
        'Product SKU': 'STYLE-1-BLK',
        Price: '[FIXED]13.00',
        'Product Visible': 'Y',
        'Product Image URL': 'https://cdn.example.com/style-1-black.jpg',
      }),
    );

    expect(result.skuRows[0]).toEqual(
      expect.objectContaining({
        'Product SKU': 'STYLE-1-BLK',
        'Stock Level': '0',
        'Free Shipping': '0',
        'Product Weight': '0.3200',
      }),
    );

    expect(BIGCOMMERCE_PRODUCT_METAFIELD_HEADERS).toEqual([
      'id',
      'sku',
      'namespace',
      'key',
      'description',
      'permission_set',
      'value',
    ]);
    expect(result.productMetafieldRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: 'STYLE-1',
          namespace: 'merchmonk',
          key: 'product_designer_defaults',
          permission_set: 'write_and_sf_access',
        }),
        expect.objectContaining({
          sku: 'STYLE-1',
          namespace: 'merchmonk',
          key: 'pricing_configuration_configuration',
          permission_set: 'app_only',
        }),
      ]),
    );
  });
});
