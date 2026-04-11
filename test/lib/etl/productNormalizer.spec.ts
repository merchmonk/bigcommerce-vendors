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

  test('decodes HTML entities in generic normalized product names', () => {
    const payload = {
      Envelope: {
        Body: {
          items: [
            { SKU: 'A-1', ProductName: 'The &quot;Best&quot; Bag &#174;' },
          ],
        },
      },
    };

    const result = normalizeProductsFromEndpoint(
      'ProductData',
      '2.0.0',
      'getProductSellable',
      payload,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('The "Best" Bag ®');
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

  test('captures the full ProductData getProduct payload into structured product data fields', () => {
    const payload = {
      getProductResponse: {
        Product: {
          productId: 'P-DETAIL',
          productName: 'Detailed Product',
          description: ['Line one', 'Line two'],
          priceExpiresDate: '2026-12-31',
          ProductMarketingPointArray: {
            ProductMarketingPoint: [{ pointType: 'Highlights', pointCopy: 'Made from recycled PET' }],
          },
          ProductKeywordArray: {
            ProductKeyword: [{ keyword: 'eco' }, { keyword: 'travel' }],
          },
          productBrand: 'Acme Brand',
          export: 'true',
          ProductCategoryArray: {
            ProductCategory: [{ category: 'Bags', subCategory: 'Totes' }],
          },
          RelatedProductArray: {
            RelatedProduct: [{ relationType: 'CompanionSell', productId: 'P-RELATED', partId: 'P-RELATED-BLK' }],
          },
          lastChangeDate: '2026-04-01T00:00:00Z',
          creationDate: '2025-11-01T00:00:00Z',
          endDate: '2027-01-01',
          effectiveDate: '2025-12-01',
          isCaution: 'true',
          cautionComment: 'Keep away from fire',
          isCloseout: false,
          lineName: 'Eco Line',
          primaryImageURL: 'https://cdn.example.com/detail.png',
          complianceInfoAvailable: true,
          unspscCommodityCode: 53121603,
          imprintSize: '4" x 3"',
          defaultSetUpCharge: '$55.00',
          defaultRunCharge: '$0.35',
          LocationDecorationArray: {
            LocationDecoration: [
              {
                locationName: 'Front',
                maxImprintColors: 3,
                decorationName: 'Screen Print',
                locationDecorationComboDefault: true,
                priceIncludes: false,
              },
            ],
          },
          FobPointArray: {
            FobPoint: [
              {
                fobId: 'TX',
                fobPostalCode: '75001',
                fobCity: 'Dallas',
                fobState: 'TX',
                fobCountry: 'US',
              },
            ],
          },
          ProductPriceGroupArray: {
            ProductPriceGroup: [
              {
                groupName: 'List',
                currency: 'USD',
                description: 'Standard list pricing',
                ProductPriceArray: {
                  ProductPrice: [
                    { quantityMin: 1, quantityMax: 23, price: 12.5, discountCode: 'A' },
                    { quantityMin: 24, quantityMax: 99, price: 11.75, discountCode: 'B' },
                  ],
                },
              },
            ],
          },
          ProductPartArray: {
            ProductPart: [
              {
                partId: 'P-DETAIL-BLK',
                description: ['Black detailed part'],
                countryOfOrigin: 'US',
                ColorArray: {
                  Color: [{ colorName: 'Black', hex: '#000000', approximatePms: 'Black 6 C', standardColorName: 'Black' }],
                },
                primaryColor: {
                  Color: { colorName: 'Black', standardColorName: 'Black' },
                },
                primaryMaterial: 'RPET',
                SpecificationArray: {
                  Specification: [{ specificationType: 'Capacity', specificationUom: 'oz', measurementValue: '20' }],
                },
                shape: 'Cylinder',
                ApparelSize: { apparelStyle: 'Unisex', labelSize: 'L' },
                Dimension: {
                  dimensionUom: 'IN',
                  height: 10,
                  width: 4,
                  depth: 4,
                  weightUom: 'LB',
                  weight: 1.5,
                },
                leadTime: 7,
                unspsc: '53121603',
                gtin: '00011122233344',
                isRushService: 'true',
                ProductPackagingArray: {
                  ProductPackaging: [
                    {
                      default: true,
                      packageType: 'Gift Box',
                      description: 'Gift box packaging',
                      quantity: 1,
                      dimensionUom: 'IN',
                      height: 12,
                      width: 5,
                      depth: 5,
                      weightUom: 'LB',
                      weight: 2,
                    },
                  ],
                },
                ShippingPackageArray: {
                  ShippingPackage: [
                    {
                      packageType: 'Carton',
                      description: 'Master carton',
                      quantity: 24,
                      dimensionUom: 'IN',
                      height: 20,
                      width: 16,
                      depth: 16,
                      weightUom: 'LB',
                      weight: 30,
                    },
                  ],
                },
                endDate: '2027-01-01',
                effectiveDate: '2025-12-01',
                isCloseout: 'false',
                isCaution: true,
                cautionComment: 'Part caution',
                nmfcCode: '156600',
                nmfcDescription: 'Bags',
                nmfcNumber: '12345',
                isOnDemand: 'true',
                isHazmat: false,
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
    expect(result[0].product_data).toMatchObject({
        product_id: 'P-DETAIL',
        product_name: 'Detailed Product',
        price_expires_date: '2026-12-31',
        export: true,
        line_name: 'Eco Line',
        compliance_info_available: true,
        unspsc_commodity_code: 53121603,
        default_set_up_charge: '$55.00',
        default_run_charge: '$0.35',
        marketing_points: expect.arrayContaining([
          expect.objectContaining({
            point_type: 'Highlights',
            point_copy: 'Made from recycled PET',
          }),
        ]),
        categories: expect.arrayContaining([
          expect.objectContaining({
            category: 'Bags',
            sub_category: 'Totes',
          }),
        ]),
        related_products: expect.arrayContaining([
          expect.objectContaining({
            relation_type: 'CompanionSell',
            product_id: 'P-RELATED',
            part_id: 'P-RELATED-BLK',
          }),
        ]),
        product_price_groups: expect.arrayContaining([
          expect.objectContaining({
            group_name: 'List',
            currency: 'USD',
            prices: expect.arrayContaining([
              expect.objectContaining({
                quantity_min: 1,
                quantity_max: 23,
                price: 12.5,
                discount_code: 'A',
              }),
            ]),
          }),
        ]),
        location_decorations: expect.arrayContaining([
          expect.objectContaining({
            location_name: 'Front',
            max_imprint_colors: 3,
            decoration_name: 'Screen Print',
          }),
        ]),
        fob_points: expect.arrayContaining([
          expect.objectContaining({
            fob_id: 'TX',
            fob_postal_code: '75001',
          }),
        ]),
        parts: expect.arrayContaining([
          expect.objectContaining({
            part_id: 'P-DETAIL-BLK',
            country_of_origin: 'US',
            primary_material: 'RPET',
            lead_time: 7,
            unspsc: '53121603',
            is_rush_service: true,
            nmfc_code: 156600,
            is_on_demand: true,
            is_hazmat: false,
            colors: expect.arrayContaining([
              expect.objectContaining({
                color_name: 'Black',
                hex: '#000000',
                standard_color_name: 'Black',
              }),
            ]),
            primary_color: expect.objectContaining({
              color_name: 'Black',
            }),
            specifications: expect.arrayContaining([
              expect.objectContaining({
                specification_type: 'Capacity',
                specification_uom: 'oz',
                measurement_value: '20',
              }),
            ]),
            apparel_size: expect.objectContaining({
              apparel_style: 'Unisex',
              label_size: 'L',
            }),
            dimension: expect.objectContaining({
              dimension_uom: 'IN',
              height: 10,
              weight_uom: 'LB',
              weight: 1.5,
            }),
            product_packaging: expect.arrayContaining([
              expect.objectContaining({
                default: true,
                package_type: 'Gift Box',
              }),
            ]),
            shipping_packages: expect.arrayContaining([
              expect.objectContaining({
                package_type: 'Carton',
                quantity: 24,
              }),
            ]),
          }),
        ]),
      });
  });

  test('decodes HTML entities in ProductData getProduct product names', () => {
    const payload = {
      getProductResponse: {
        Product: {
          productId: 'P-HTML',
          productName: 'The &quot;Best&quot; Polo &#174;',
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
    expect(result[0].name).toBe('The "Best" Polo ®');
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
