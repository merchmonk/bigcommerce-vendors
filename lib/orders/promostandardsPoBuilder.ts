import type {
  BigCommerceOrderBundle,
  BigCommerceOrderProduct,
  BigCommerceOrderShippingAddress,
  OrderIntakeOverrides,
  VendorOrderLineItem,
} from './bigcommerceOrderTypes';

export interface PromostandardsPurchaseOrderPayload {
  order_type: 'Blank' | 'Configured' | 'Sample' | 'Simple';
  request_fields: {
    PO: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return (override as T) ?? base;
  }

  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return override as T;
  }

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      result[key] = value;
      continue;
    }

    if (value && typeof value === 'object') {
      result[key] = deepMerge(result[key], value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

function buildContactDetails(address: {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  street_1?: string | null;
  street_2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country_iso2?: string | null;
  email?: string | null;
  phone?: string | null;
}): Record<string, unknown> {
  return {
    attentionTo: [address.first_name, address.last_name].filter(Boolean).join(' ').trim() || undefined,
    companyName: asTrimmedString(address.company),
    address1: asTrimmedString(address.street_1),
    address2: asTrimmedString(address.street_2),
    city: asTrimmedString(address.city),
    region: asTrimmedString(address.state),
    postalCode: asTrimmedString(address.zip),
    country: asTrimmedString(address.country_iso2) ?? 'US',
    email: asTrimmedString(address.email),
    phone: asTrimmedString(address.phone),
  };
}

function buildShipmentMethod(shippingMethod: string | null | undefined): { carrier: string; service: string } {
  const normalized = asTrimmedString(shippingMethod) ?? 'Standard';
  const [carrier = 'Standard', ...serviceParts] = normalized.split(' ');
  return {
    carrier,
    service: serviceParts.join(' ').trim() || normalized,
  };
}

function resolveShippingAddressId(
  shippingAddresses: BigCommerceOrderShippingAddress[],
  orderProduct: BigCommerceOrderProduct,
): number {
  const matchingAddress = shippingAddresses.find(address => address.id === orderProduct.order_address_id);
  if (matchingAddress) return matchingAddress.id;
  return shippingAddresses[0]?.id ?? 1;
}

function buildShipmentMap(
  shippingAddresses: BigCommerceOrderShippingAddress[],
  billingAddress: Record<string, unknown>,
): {
  shipmentIdByAddressId: Map<number, number>;
  shipments: Record<string, unknown>[];
} {
  const shipmentIdByAddressId = new Map<number, number>();
  const sourceAddresses = shippingAddresses.length > 0
    ? shippingAddresses
    : [
        {
          id: 1,
          country_iso2: 'US',
        } as BigCommerceOrderShippingAddress,
      ];

  const shipments = sourceAddresses.map((address, index) => {
    const shipmentId = index + 1;
    shipmentIdByAddressId.set(address.id, shipmentId);

    const freight = buildShipmentMethod(address.shipping_method);
    const shipToDetails = Object.keys(buildContactDetails(address)).length > 0
      ? buildContactDetails(address)
      : billingAddress;

    return {
      shipReferences: [],
      allowConsolidation: true,
      blindShip: false,
      packingListRequired: true,
      FreightDetails: freight,
      ShipTo: {
        customerPickup: false,
        ContactDetails: shipToDetails,
        shipmentId,
      },
    };
  });

  return {
    shipmentIdByAddressId,
    shipments,
  };
}

function buildToleranceDetails(): Record<string, unknown> {
  return {
    tolerance: 'ExactOnly',
  };
}

function resolveUnitPrice(orderProduct: BigCommerceOrderProduct): number {
  return asNumber(orderProduct.price_ex_tax, asNumber(orderProduct.base_price));
}

function resolveLineTotal(orderProduct: BigCommerceOrderProduct): number {
  const explicitTotal = asNumber(orderProduct.total_ex_tax, NaN);
  if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
    return explicitTotal;
  }

  return resolveUnitPrice(orderProduct) * asNumber(orderProduct.quantity, 0);
}

function findLineOverride(
  overrides: OrderIntakeOverrides | undefined,
  lineKey: string,
): Record<string, unknown> | undefined {
  return overrides?.line_item_overrides?.find(override => override.line_key === lineKey)?.request_fields;
}

function inferOrderType(overrides: OrderIntakeOverrides | undefined): PromostandardsPurchaseOrderPayload['order_type'] {
  const explicitOrderType =
    asTrimmedString(overrides?.po_overrides?.orderType)
    ?? asTrimmedString(overrides?.po_overrides?.order_type);
  if (
    explicitOrderType === 'Blank'
    || explicitOrderType === 'Configured'
    || explicitOrderType === 'Sample'
    || explicitOrderType === 'Simple'
  ) {
    return explicitOrderType;
  }

  const hasConfiguration = overrides?.line_item_overrides?.some(override =>
    Object.hasOwn(override.request_fields ?? {}, 'Configuration'),
  );
  return hasConfiguration ? 'Configured' : 'Blank';
}

export function buildBigCommerceOrderLineKey(orderProduct: BigCommerceOrderProduct): string {
  return `bc-line-${orderProduct.id}`;
}

export function buildPromostandardsPurchaseOrder(input: {
  vendorId: number;
  externalOrderId: string;
  purchaseOrderNumber: string;
  orderBundle: BigCommerceOrderBundle;
  vendorLineItems: VendorOrderLineItem[];
  overrides?: OrderIntakeOverrides;
}): PromostandardsPurchaseOrderPayload {
  const billingDetails = buildContactDetails(input.orderBundle.order.billing_address ?? {});
  const { shipmentIdByAddressId, shipments } = buildShipmentMap(
    input.orderBundle.shippingAddresses,
    billingDetails,
  );

  const lineItems = input.vendorLineItems.map((vendorLineItem, index) => {
    const orderProduct = vendorLineItem.order_product;
    const shipmentId = shipmentIdByAddressId.get(
      resolveShippingAddressId(input.orderBundle.shippingAddresses, orderProduct),
    ) ?? 1;
    const quantity = asNumber(orderProduct.quantity, 0);
    const unitPrice = resolveUnitPrice(orderProduct);
    const lineItemTotal = resolveLineTotal(orderProduct);

    const baselineLine = {
      lineNumber: index + 1,
      lineReferenceId: vendorLineItem.line_key,
      description: asTrimmedString(orderProduct.name) ?? vendorLineItem.supplier_product_id ?? `Product ${orderProduct.product_id}`,
      lineType: 'Order',
      Quantity: {
        uom: 'EA',
        value: quantity,
      },
      ToleranceDetails: buildToleranceDetails(),
      allowPartialShipments: true,
      unitPrice,
      lineItemTotal,
      endCustomerSalesOrder: input.externalOrderId,
      productId: vendorLineItem.supplier_product_id ?? String(orderProduct.product_id),
      customerProductId: String(orderProduct.product_id),
      PartArray: {
        Part: [
          {
            partId: vendorLineItem.supplier_part_id ?? vendorLineItem.supplier_product_id ?? String(orderProduct.product_id),
            customerSupplied: false,
            description: asTrimmedString(orderProduct.name) ?? undefined,
            Quantity: {
              uom: 'EA',
              value: quantity,
            },
            unitPrice,
            extendedPrice: lineItemTotal,
            ShipmentLinkArray: {
              ShipmentLink: [
                {
                  Quantity: {
                    uom: 'EA',
                    value: quantity,
                  },
                  shipmentId,
                },
              ],
            },
          },
        ],
      },
    };

    const lineOverride = findLineOverride(input.overrides, vendorLineItem.line_key);
    return lineOverride ? deepMerge(baselineLine, lineOverride) : baselineLine;
  });

  const poOrderType = inferOrderType(input.overrides);
  const baselinePo = {
    orderType: poOrderType,
    orderNumber: input.purchaseOrderNumber,
    orderDate: input.orderBundle.order.date_created ?? new Date().toISOString(),
    lastModified: input.orderBundle.order.date_modified ?? input.orderBundle.order.date_created ?? undefined,
    totalAmount: lineItems.reduce((total, lineItem) => total + asNumber((lineItem as Record<string, unknown>).lineItemTotal), 0),
    paymentTerms: 'Prepaid',
    rush: false,
    currency:
      asTrimmedString(input.orderBundle.order.currency_code)
      ?? asTrimmedString(input.orderBundle.order.default_currency_code)
      ?? 'USD',
    OrderContactArray: {
      Contact: [
        {
          contactType: 'Bill',
          ContactDetails: billingDetails,
        },
      ],
    },
    ShipmentArray: {
      Shipment: shipments,
    },
    LineItemArray: {
      LineItem: lineItems,
    },
    termsAndConditions: asTrimmedString(input.orderBundle.order.customer_message) ?? '',
    salesChannel: 'BigCommerce',
  };

  const mergedPo = input.overrides?.po_overrides ? deepMerge(baselinePo, input.overrides.po_overrides) : baselinePo;

  return {
    order_type: poOrderType,
    request_fields: {
      PO: mergedPo,
    },
    metadata: {
      vendor_id: input.vendorId,
      external_order_id: input.externalOrderId,
      shipment_count: shipments.length,
      line_count: lineItems.length,
    },
  };
}
