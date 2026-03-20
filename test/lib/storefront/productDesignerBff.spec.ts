import { getProductDesignerPayload } from '@lib/storefront/productDesignerBff';

const mockLoadBigCommerceDesignerRuntimeBundle = jest.fn();

jest.mock('@lib/storefront/bigcommerceRuntimeReader', () => ({
  loadBigCommerceDesignerRuntimeBundle: (...args: unknown[]) => mockLoadBigCommerceDesignerRuntimeBundle(...args),
}));

describe('getProductDesignerPayload', () => {
  beforeEach(() => {
    mockLoadBigCommerceDesignerRuntimeBundle.mockReset();
  });

  test('builds a selection-scoped payload from BigCommerce runtime data', async () => {
    mockLoadBigCommerceDesignerRuntimeBundle.mockResolvedValue({
      product: {
        id: 1457,
        name: 'Port Authority Core Cotton Tee',
        sku: 'PORT-CORE-TEE',
        description: 'Blank cotton tee',
        price: 9.1,
        search_keywords: 'tee,cotton,screen print',
        brand_id: 18,
        categories: [2, 4],
        inventory_tracking: 'variant',
        custom_url: {
          url: '/port-authority-core-cotton-tee',
        },
        custom_fields: [
          { name: 'vendor_id', value: '22' },
        ],
        images: [
          {
            url_standard: 'https://cdn.example.com/products/1457/main.jpg',
            description: 'Front view',
            is_thumbnail: true,
          },
        ],
      },
      variants: [
        {
          id: 8842,
          sku: 'PC54-BLK-XL',
          price: 9.45,
          inventory_level: 640,
          option_values: [
            { option_display_name: 'Color', label: 'Black' },
            { option_display_name: 'Size', label: 'XL' },
          ],
        },
      ],
      modifiers: [],
      relatedProducts: [
        {
          id: 1460,
          name: 'Port Authority Long Sleeve Tee',
          sku: 'PORT-LS-TEE',
          custom_url: {
            url: '/port-authority-long-sleeve-tee',
          },
        },
      ],
      brand: {
        id: 18,
        name: 'Port Authority',
      },
      categories: [
        { id: 2, name: 'Apparel' },
        { id: 4, name: 'T-Shirts' },
      ],
      productMetafields: [
        {
          id: 1,
          namespace: 'merchmonk',
          key: 'product_designer_defaults',
          value: JSON.stringify({
            contractVersion: '2026-03-18.1',
            source: {
              vendorProductId: 'PC54',
            },
            pricing: {
              priceListId: 1,
              currency: 'USD',
              variantCatalog: [
                {
                  sku: 'PC54-BLK-XL',
                  partId: 'PC54-BLK-XL',
                  color: 'Black',
                  size: 'XL',
                  priceTiers: [
                    { minQuantity: 1, price: 10.1 },
                    { minQuantity: 72, price: 9.45 },
                  ],
                },
              ],
            },
            fobPoints: [
              {
                id: 'GA-ATL',
                city: 'Atlanta',
                state: 'GA',
                country: 'US',
              },
            ],
            locations: [
              {
                id: 'full_front',
                locationId: 'FULL_FRONT',
                name: 'Full Front',
                includedDecorations: 1,
                minDecorations: 1,
                maxDecorations: 4,
                isDefault: true,
                methods: [
                  {
                    id: 'screen_print',
                    name: 'Screen Print',
                    isDefault: true,
                    printArea: {
                      geometry: 'rectangular',
                      width: 12,
                      height: 14,
                      uom: 'IN',
                    },
                    charges: [
                      {
                        id: 'setup',
                        name: 'Setup',
                        type: 'setup',
                        tiers: [{ minQuantity: 1, price: 45 }],
                      },
                      {
                        id: 'run',
                        name: 'Run',
                        type: 'run',
                        appliesPerColor: 1,
                        tiers: [
                          { minQuantity: 48, minUnits: 1, price: 1.35 },
                          { minQuantity: 96, minUnits: 1, price: 1.1 },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                id: 'full_back',
                locationId: 'FULL_BACK',
                name: 'Full Back',
                includedDecorations: 1,
                minDecorations: 1,
                maxDecorations: 4,
                methods: [
                  {
                    id: 'screen_print',
                    name: 'Screen Print',
                    charges: [],
                  },
                ],
              },
            ],
          }),
        },
      ],
      variantMetafields: [
        {
          id: 9,
          namespace: 'merchmonk',
          key: 'variant_designer_override',
          value: JSON.stringify({
            contractVersion: '2026-03-18.1',
            partId: 'PC54-BLK-XL',
            size: 'XL',
            applicableLocationIds: ['FULL_FRONT'],
            physical: {
              dimension: {
                width: 24,
                height: 32,
                uom: 'IN',
              },
            },
          }),
        },
      ],
    });

    const payload = await getProductDesignerPayload({
      accessToken: 'token',
      storeHash: 'storehash',
      productId: 1457,
      variantId: 8842,
      quantity: 96,
    });

    expect(payload).toEqual({
      product: {
        productId: 1457,
        name: 'Port Authority Core Cotton Tee',
        sku: 'PORT-CORE-TEE',
        path: '/port-authority-core-cotton-tee',
        brand: 'Port Authority',
        description: 'Blank cotton tee',
        categories: ['Apparel', 'T-Shirts'],
        searchKeywords: ['tee', 'cotton', 'screen print'],
        primaryImage: {
          url: 'https://cdn.example.com/products/1457/main.jpg',
          alt: 'Front view',
        },
        source: {
          vendorId: 22,
          vendorProductId: 'PC54',
          contractVersion: '2026-03-18.1',
        },
      },
      selectedVariant: {
        variantId: 8842,
        sku: 'PC54-BLK-XL',
        partId: 'PC54-BLK-XL',
        options: {
          color: 'Black',
          size: 'XL',
          part: 'PC54-BLK-XL',
        },
        physical: {
          dimension: {
            width: 24,
            height: 32,
            uom: 'IN',
          },
        },
        overrideKeysApplied: ['applicableLocationIds', 'physical.dimension.height', 'physical.dimension.uom', 'physical.dimension.width'],
      },
      basePricing: {
        currencyCode: 'USD',
        quantity: 96,
        priceListId: 1,
        unitBlankPrice: 9.45,
        tierApplied: {
          minQuantity: 72,
          source: 'contract',
        },
        fobPoints: [
          {
            id: 'GA-ATL',
            city: 'Atlanta',
            state: 'GA',
            country: 'US',
          },
        ],
      },
      inventory: {
        available: 640,
        inventoryTracked: true,
        status: 'in_stock',
      },
      designer: {
        contractVersion: '2026-03-18.1',
        locations: [
          {
            id: 'full_front',
            name: 'Full Front',
            includedDecorations: 1,
            minDecorations: 1,
            maxDecorations: 4,
            printableArea: {
              geometry: 'rectangular',
              width: 12,
              height: 14,
              uom: 'IN',
            },
            methods: [
              {
                id: 'screen_print',
                name: 'Screen Print',
                isDefault: true,
                printArea: {
                  geometry: 'rectangular',
                  width: 12,
                  height: 14,
                  uom: 'IN',
                },
                charges: [
                  {
                    id: 'setup',
                    name: 'Setup',
                    type: 'setup',
                    tiers: [{ minQuantity: 1, price: 45 }],
                  },
                  {
                    id: 'run',
                    name: 'Run',
                    type: 'run',
                    appliesPerColor: 1,
                    tiers: [
                      { minQuantity: 48, minUnits: 1, price: 1.35 },
                      { minQuantity: 96, minUnits: 1, price: 1.1 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      media: {
        gallery: [
          {
            url: 'https://cdn.example.com/products/1457/main.jpg',
            alt: 'Front view',
            kind: 'product',
          },
        ],
      },
      relatedProducts: [
        {
          productId: 1460,
          name: 'Port Authority Long Sleeve Tee',
          path: '/port-authority-long-sleeve-tee',
        },
      ],
      pricingPreview: {
        quantity: 96,
        currencyCode: 'USD',
        blankUnitPrice: 9.45,
        decorationUnitPrice: 1.1,
        oneTimeCharges: 45,
        recurringCharges: 105.6,
        estimatedUnitSellPrice: 11.02,
        estimatedLineTotal: 1057.8,
      },
    });
  });
});
