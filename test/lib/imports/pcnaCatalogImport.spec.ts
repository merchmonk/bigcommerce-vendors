import { buildPcnaCatalogImport } from '@lib/imports/pcnaCatalogImport';

describe('buildPcnaCatalogImport', () => {
  test('builds a variant product with pricing tiers, media assets, and decoration modifiers', () => {
    const result = buildPcnaCatalogImport({
      vendorId: 10,
      vendorName: 'PCNA',
      markupPercent: 30,
      productDataRows: [
        {
          Division: 'Leeds',
          Brand: 'CamelBak',
          PCNA_Style_Number: '1627-30',
          PCNA_SKU_Number: '1627-30OXFD',
          CategoryWeb: 'Outdoor & Sport',
          SubCategoryWeb: 'Drinkware',
          ItemName: 'CamelBak Chute Mag 25oz Bottle Tritan Renew',
          SeriesName: 'CamelBak Chute Mag 25oz Bottle Tritan Renew',
          Description: 'Hydration bottle',
          MARKET_COLORS: 'Oxford (OXFD)',
          Product_Dimensions: '9.80 H x 3.70 W x 3.07 L',
          Product_Size: '',
          Product_Weight: '0.32 LB',
          MaterialsDescription: 'BPA-free Eastman Tritan Material',
          EffectiveDate: '7/1/2021',
          PackagingDetails: '',
          MemorySize: '',
          Hazmat: 'FALSE',
          Caution: 'FALSE',
          CautionComments: '',
        },
        {
          Division: 'Leeds',
          Brand: 'CamelBak',
          PCNA_Style_Number: '1627-30',
          PCNA_SKU_Number: '1627-30BLK',
          CategoryWeb: 'Outdoor & Sport',
          SubCategoryWeb: 'Drinkware',
          ItemName: 'CamelBak Chute Mag 25oz Bottle Tritan Renew',
          SeriesName: 'CamelBak Chute Mag 25oz Bottle Tritan Renew',
          Description: 'Hydration bottle',
          MARKET_COLORS: 'Black (BK)',
          Product_Dimensions: '9.80 H x 3.70 W x 3.07 L',
          Product_Size: '',
          Product_Weight: '0.32 LB',
          MaterialsDescription: 'BPA-free Eastman Tritan Material',
          EffectiveDate: '7/1/2021',
          PackagingDetails: '',
          MemorySize: '',
          Hazmat: 'FALSE',
          Caution: 'FALSE',
          CautionComments: '',
        },
      ],
      pricingRows: [
        {
          SKU: '1627-30OXFD',
          Style: '1627-30',
          quantityMin: '1',
          price: '10.00',
          discountCode: 'C',
          CurrencyID: 'USD',
          PriceType: 'USD-List-Blank_1',
          PriceDescription: 'USD-List-Blank',
        },
        {
          SKU: '1627-30OXFD',
          Style: '1627-30',
          quantityMin: '24',
          price: '9.50',
          discountCode: 'C',
          CurrencyID: 'USD',
          PriceType: 'USD-List-Blank_1',
          PriceDescription: 'USD-List-Blank',
        },
        {
          SKU: '1627-30OXFD',
          Style: '1627-30',
          quantityMin: '1',
          price: '8.00',
          discountCode: 'N',
          CurrencyID: 'USD',
          PriceType: 'USD-Net-Blank_1',
          PriceDescription: 'USD-Net-Blank',
        },
        {
          SKU: '1627-30OXFD',
          Style: '1627-30',
          quantityMin: '1',
          price: '12.00',
          discountCode: 'N',
          CurrencyID: 'USD',
          PriceType: 'USD-Net-Decorated_1',
          PriceDescription: 'USD-Net-Decorated',
        },
        {
          SKU: '1627-30BLK',
          Style: '1627-30',
          quantityMin: '1',
          price: '11.00',
          discountCode: 'C',
          CurrencyID: 'USD',
          PriceType: 'USD-List-Blank_1',
          PriceDescription: 'USD-List-Blank',
        },
        {
          SKU: '1627-30BLK',
          Style: '1627-30',
          quantityMin: '1',
          price: '9.00',
          discountCode: 'N',
          CurrencyID: 'USD',
          PriceType: 'USD-Net-Blank_1',
          PriceDescription: 'USD-Net-Blank',
        },
        {
          SKU: '1627-30BLK',
          Style: '1627-30',
          quantityMin: '1',
          price: '13.00',
          discountCode: 'N',
          CurrencyID: 'USD',
          PriceType: 'USD-Net-Decorated_1',
          PriceDescription: 'USD-Net-Decorated',
        },
      ],
      mediaRows: [
        {
          Style: '1627-30OXFD',
          Sku: '1627-30',
          Url: 'https://assets.example.com/1627-30OXFD-default.jpg',
          Description: 'Oxford default',
          MediaType: '',
          ClassTypeName: 'HiRes,Product Default Image,Part Default Image',
          ClassTypeId: '605,902,1006',
        },
        {
          Style: '1627-30BLK',
          Sku: '1627-30',
          Url: 'https://assets.example.com/1627-30BLK-default.jpg',
          Description: 'Black default',
          MediaType: '',
          ClassTypeName: 'HiRes,Part Default Image',
          ClassTypeId: '605,1006',
        },
      ],
      decorationRows: [
        {
          SKU: '1627-30OXFD',
          Style: '1627-30',
          DecorationId: '8',
          DecorationName: 'Screen Print',
          Priority: 'true',
          MaxLength: '2.00',
          MaxHeight: '2.00',
          LocationName: 'Centered On Front',
          LocationId: '4295',
        },
        {
          SKU: '1627-30BLK',
          Style: '1627-30',
          DecorationId: '9',
          DecorationName: 'Laser Engraving',
          Priority: 'false',
          MaxLength: '2.00',
          MaxHeight: '2.00',
          LocationName: 'Centered On Front',
          LocationId: '4295',
        },
      ],
    });

    expect(result.products).toHaveLength(1);
    expect(result.report.total_products).toBe(1);
    expect(result.report.variant_products).toBe(1);

    const [product] = result.products;
    expect(product.vendor_product_id).toBe('1627-30');
    expect(product.sku).toBe('1627-30');
    expect(product.name).toBe('CamelBak Chute Mag 25oz Bottle Tritan Renew');
    expect(product.brand_name).toBe('CamelBak');
    expect(product.categories).toEqual(['Outdoor & Sport > Drinkware']);
    expect(product.weight).toBeCloseTo(0.32);
    expect(product.price).toBe(10);
    expect(product.cost_price).toBe(10);
    expect(product.images).toEqual([
      {
        image_url: 'https://assets.example.com/1627-30OXFD-default.jpg',
        is_thumbnail: true,
      },
    ]);
    expect(product.custom_fields).toEqual(
      expect.arrayContaining([
        { name: 'vendor_endpoint', value: 'CSVImport' },
        { name: 'vendor_operation', value: 'pcna_initial_import' },
        { name: 'vendor_product_id', value: '1627-30' },
      ]),
    );
    expect(product.variants).toEqual([
      expect.objectContaining({
        sku: '1627-30OXFD',
        price: 10,
        cost_price: 10,
        option_values: [{ option_display_name: 'Color', label: 'Oxford' }],
      }),
      expect.objectContaining({
        sku: '1627-30BLK',
        price: 11,
        cost_price: 11,
        option_values: [{ option_display_name: 'Color', label: 'Black' }],
      }),
    ]);
    expect(product.media_assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://assets.example.com/1627-30OXFD-default.jpg',
          product_id: '1627-30',
          part_id: '1627-30OXFD',
          class_type_array: expect.arrayContaining([
            expect.objectContaining({ class_type_id: '605', class_type_name: 'HiRes' }),
            expect.objectContaining({ class_type_id: '902', class_type_name: 'Product Default Image' }),
            expect.objectContaining({ class_type_id: '1006', class_type_name: 'Part Default Image' }),
          ]),
        }),
        expect.objectContaining({
          url: 'https://assets.example.com/1627-30BLK-default.jpg',
          product_id: '1627-30',
          part_id: '1627-30BLK',
        }),
      ]),
    );
    expect(product.pricing_configuration?.currency).toBe('USD');
    expect(product.pricing_configuration?.parts).toEqual([
      expect.objectContaining({
        part_id: '1627-30OXFD',
        price_tiers: expect.arrayContaining([
          expect.objectContaining({
            min_quantity: 1,
            price: 10,
            quantity_max: 23,
            currency: 'USD',
            price_type: 'List',
            configuration_type: 'Blank',
            discount_code: 'C',
          }),
          expect.objectContaining({
            min_quantity: 24,
            price: 9.5,
            currency: 'USD',
            price_type: 'List',
            configuration_type: 'Blank',
            discount_code: 'C',
          }),
          expect.objectContaining({
            min_quantity: 1,
            price: 8,
            currency: 'USD',
            price_type: 'Net',
            configuration_type: 'Blank',
            discount_code: 'N',
          }),
          expect.objectContaining({
            min_quantity: 1,
            price: 12,
            currency: 'USD',
            price_type: 'Net',
            configuration_type: 'Decorated',
            discount_code: 'N',
          }),
        ]),
      }),
      expect.objectContaining({
        part_id: '1627-30BLK',
        price_tiers: expect.arrayContaining([
          expect.objectContaining({ min_quantity: 1, price: 11, price_type: 'List', configuration_type: 'Blank' }),
          expect.objectContaining({ min_quantity: 1, price: 9, price_type: 'Net', configuration_type: 'Blank' }),
          expect.objectContaining({
            min_quantity: 1,
            price: 13,
            price_type: 'Net',
            configuration_type: 'Decorated',
          }),
        ]),
      }),
    ]);
    expect(product.modifier_blueprint).toEqual({
      locations: [
        {
          location: 'Centered On Front',
          methods: [{ method: 'Laser Engraving' }, { method: 'Screen Print' }],
        },
      ],
      charges: [],
    });
    expect(product.location_decoration_data).toEqual(
      expect.objectContaining({
        dimensions: {
          width: 3.7,
          height: 9.8,
          depth: 3.07,
        },
        LocationDecoration: expect.arrayContaining([
          expect.objectContaining({
            locationId: '4295',
            locationName: 'Centered On Front',
            decorationId: '8',
            decorationName: 'Screen Print',
            locationDecorationComboDefault: true,
          }),
        ]),
      }),
    );
    expect(product.pricing_configuration?.locations).toEqual([
      expect.objectContaining({
        location_id: '4295',
        location_name: 'Centered On Front',
        default_location: true,
        location_rank: 1,
        decorations: expect.arrayContaining([
          expect.objectContaining({
            decoration_id: '8',
            decoration_name: 'Screen Print',
            decoration_width: 2,
            decoration_height: 2,
            decoration_geometry: 'rectangular',
            decoration_uom: 'IN',
            default_decoration: true,
          }),
        ]),
      }),
    ]);
  });

  test('keeps a single-row style as a simple product', () => {
    const result = buildPcnaCatalogImport({
      vendorId: 10,
      vendorName: 'PCNA',
      markupPercent: 30,
      productDataRows: [
        {
          Division: 'Bullet',
          Brand: 'The Goods',
          PCNA_Style_Number: 'SM-6003',
          PCNA_SKU_Number: 'SM-6003GY',
          CategoryWeb: 'Bags',
          SubCategoryWeb: 'Coolers',
          ItemName: 'Recycled 36 Can Flip Top Cooler',
          SeriesName: 'Recycled 36 Can Flip Top Cooler',
          Description: 'Cooler description',
          MARKET_COLORS: '',
          Product_Dimensions: '11.00 H x 9.00 W x 15.00 L',
          Product_Size: '',
          Product_Weight: '1.15 LB',
          MaterialsDescription: 'Recycled 600D Polyester',
          EffectiveDate: '9/1/2023',
          PackagingDetails: '',
          MemorySize: '',
          Hazmat: 'FALSE',
          Caution: 'FALSE',
          CautionComments: '',
        },
      ],
      pricingRows: [
        {
          SKU: 'SM-6003GY',
          Style: 'SM-6003',
          quantityMin: '1',
          price: '20.00',
          discountCode: 'C',
          CurrencyID: 'USD',
          PriceType: 'USD-List-Blank_1',
          PriceDescription: 'USD-List-Blank',
        },
      ],
      mediaRows: [],
      decorationRows: [],
    });

    expect(result.products).toHaveLength(1);
    const [product] = result.products;
    expect(product.vendor_product_id).toBe('SM-6003');
    expect(product.sku).toBe('SM-6003GY');
    expect(product.variants).toBeUndefined();
    expect(product.price).toBe(20);
    expect(product.cost_price).toBe(20);
    expect(product.categories).toEqual(['Bags > Coolers']);
  });
});
