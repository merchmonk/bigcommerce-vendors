import {
  buildBigCommerceOrderLineKey,
  buildPromostandardsPurchaseOrder,
} from '@lib/orders/promostandardsPoBuilder';

describe('promostandardsPoBuilder', () => {
  const orderBundle = {
    order: {
      id: 1001,
      currency_code: 'USD',
      default_currency_code: 'USD',
      date_created: '2026-03-19T12:00:00Z',
      date_modified: '2026-03-19T12:15:00Z',
      customer_message: 'Please keep grouped by size.',
      billing_address: {
        first_name: 'Avery',
        last_name: 'Stone',
        company: 'Northwind',
        street_1: '1 Market Street',
        street_2: 'Suite 200',
        city: 'Denver',
        state: 'CO',
        zip: '80202',
        country_iso2: 'US',
        email: 'avery@example.com',
        phone: '555-0100',
      },
    },
    products: [
      {
        id: 10,
        product_id: 501,
        variant_id: 901,
        sku: 'TS-BLK-M',
        name: 'Acme Tee',
        quantity: 24,
        base_price: 12.5,
        price_ex_tax: 12.5,
        total_ex_tax: 300,
        order_address_id: 7001,
      },
    ],
    shippingAddresses: [
      {
        id: 7001,
        first_name: 'Avery',
        last_name: 'Stone',
        company: 'Northwind',
        street_1: '1 Market Street',
        street_2: 'Suite 200',
        city: 'Denver',
        state: 'CO',
        zip: '80202',
        country_iso2: 'US',
        email: 'avery@example.com',
        phone: '555-0100',
        shipping_method: 'UPS Ground',
      },
    ],
  };

  test('builds a baseline blank PO payload from a BigCommerce order', () => {
    const orderProduct = orderBundle.products[0];

    const result = buildPromostandardsPurchaseOrder({
      vendorId: 14,
      externalOrderId: '1001',
      purchaseOrderNumber: 'MM-1001-V14',
      orderBundle,
      vendorLineItems: [
        {
          vendor_id: 14,
          bigcommerce_product_id: 501,
          vendor_product_id: 'SUP-TEE-100',
          line_key: buildBigCommerceOrderLineKey(orderProduct),
          order_product: orderProduct,
          supplier_product_id: 'TEE-100',
          supplier_part_id: 'TS-BLK-M',
        },
      ],
    });

    const po = result.request_fields.PO as {
      ShipmentArray: { Shipment: Array<Record<string, unknown>> };
      LineItemArray: { LineItem: Array<Record<string, unknown>> };
      orderNumber: string;
      currency: string;
    };

    expect(result.order_type).toBe('Blank');
    expect(po.orderNumber).toBe('MM-1001-V14');
    expect(po.currency).toBe('USD');
    expect(po.ShipmentArray.Shipment).toHaveLength(1);
    expect(po.LineItemArray.LineItem).toHaveLength(1);
    expect(po.LineItemArray.LineItem[0]).toMatchObject({
      lineNumber: 1,
      lineReferenceId: buildBigCommerceOrderLineKey(orderProduct),
      lineType: 'Order',
      lineItemTotal: 300,
      productId: 'TEE-100',
      customerProductId: '501',
    });
    expect((po.LineItemArray.LineItem[0] as any).PartArray.Part[0]).toMatchObject({
      partId: 'TS-BLK-M',
      customerSupplied: false,
      unitPrice: 12.5,
      extendedPrice: 300,
    });
  });

  test('marks the PO as configured and merges line-level overrides', () => {
    const orderProduct = orderBundle.products[0];
    const lineKey = buildBigCommerceOrderLineKey(orderProduct);

    const result = buildPromostandardsPurchaseOrder({
      vendorId: 14,
      externalOrderId: '1001',
      purchaseOrderNumber: 'MM-1001-V14',
      orderBundle,
      vendorLineItems: [
        {
          vendor_id: 14,
          bigcommerce_product_id: 501,
          vendor_product_id: 'SUP-TEE-100',
          line_key: lineKey,
          order_product: orderProduct,
          supplier_product_id: 'TEE-100',
          supplier_part_id: 'TS-BLK-M',
        },
      ],
      overrides: {
        po_overrides: {
          rush: true,
        },
        line_item_overrides: [
          {
            line_key: lineKey,
            request_fields: {
              Configuration: {
                preProductionProof: true,
                LocationArray: {
                  Location: [
                    {
                      locationName: 'Front',
                      locationLinkId: 1,
                      locationId: 10,
                      DecorationArray: {
                        Decoration: [
                          {
                            decorationName: 'Screen Print',
                            decorationId: 77,
                            Artwork: {
                              instructions: 'Use supplied vector art',
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    });

    const po = result.request_fields.PO as {
      rush: boolean;
      LineItemArray: { LineItem: Array<Record<string, unknown>> };
    };

    expect(result.order_type).toBe('Configured');
    expect(po.rush).toBe(true);
    expect((po.LineItemArray.LineItem[0] as any).Configuration).toMatchObject({
      preProductionProof: true,
      LocationArray: {
        Location: [
          {
            locationName: 'Front',
            locationLinkId: 1,
            locationId: 10,
          },
        ],
      },
    });
  });
});
