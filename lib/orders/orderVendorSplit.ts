import { findVendorProductMapsByBigCommerceProductIds } from '../etl/repository';
import {
  getBigCommerceCatalogOrderContextProduct,
} from './bigcommerceOrderReader';
import type {
  BigCommerceCatalogOrderContextProduct,
  BigCommerceOrderBundle,
  BigCommerceOrderProduct,
  OrderIntakeOverrides,
  VendorOrderGroup,
  VendorOrderLineItem,
} from './bigcommerceOrderTypes';

function normalizeString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function readVendorIdFromCustomFields(product: BigCommerceCatalogOrderContextProduct): number | null {
  const vendorField = product.custom_fields?.find(field => field.name === 'vendor_id');
  return parsePositiveInteger(vendorField?.value);
}

export function buildVendorPurchaseOrderNumber(externalOrderId: string, vendorId: number): string {
  const raw = `MM-${externalOrderId}-V${vendorId}`;
  return raw.length <= 64 ? raw : raw.slice(0, 64);
}

function buildProductLookupKey(orderProduct: BigCommerceOrderProduct): string {
  return `${orderProduct.product_id}:${normalizeString(orderProduct.sku) ?? ''}`;
}

function hasConfigurationOverride(
  overrides: OrderIntakeOverrides | undefined,
  lineKey: string,
): boolean {
  return !!overrides?.line_item_overrides?.some(override => {
    if (override.line_key !== lineKey) return false;
    return Object.hasOwn(override.request_fields ?? {}, 'Configuration');
  });
}

export async function resolveVendorOrderGroups(input: {
  accessToken: string;
  storeHash: string;
  externalOrderId: string;
  orderBundle: BigCommerceOrderBundle;
  overrides?: OrderIntakeOverrides;
}): Promise<VendorOrderGroup[]> {
  const productIds = Array.from(
    new Set(
      input.orderBundle.products
        .map(product => parsePositiveInteger(product.product_id))
        .filter((value): value is number => value !== null),
    ),
  );

  const productMaps = await findVendorProductMapsByBigCommerceProductIds(productIds);
  const productMapsByLookup = new Map<string, (typeof productMaps)[number]>();
  for (const record of productMaps) {
    productMapsByLookup.set(`${record.bigcommerce_product_id}:${record.sku}`, record);
  }
  const productMapsByProductId = new Map<number, typeof productMaps>();
  for (const record of productMaps) {
    if (!record.bigcommerce_product_id) continue;
    const existing = productMapsByProductId.get(record.bigcommerce_product_id) ?? [];
    existing.push(record);
    productMapsByProductId.set(record.bigcommerce_product_id, existing);
  }

  const catalogProductCache = new Map<number, BigCommerceCatalogOrderContextProduct>();
  const groupsByVendorId = new Map<number, VendorOrderGroup>();

  for (const orderProduct of input.orderBundle.products) {
    const productId = parsePositiveInteger(orderProduct.product_id);
    if (!productId) {
      throw new Error(`BigCommerce order product ${orderProduct.id} is missing a valid product_id.`);
    }

    const productLookupKey = buildProductLookupKey(orderProduct);
    const exactMap = productMapsByLookup.get(productLookupKey);
    const relatedMaps = productMapsByProductId.get(productId) ?? [];
    const fallbackMap = exactMap ?? relatedMaps[0];

    let vendorId = fallbackMap?.vendor_id ?? null;
    if (!vendorId) {
      let catalogProduct = catalogProductCache.get(productId);
      if (!catalogProduct) {
        catalogProduct = await getBigCommerceCatalogOrderContextProduct({
          accessToken: input.accessToken,
          storeHash: input.storeHash,
          productId,
        });
        catalogProductCache.set(productId, catalogProduct);
      }
      vendorId = readVendorIdFromCustomFields(catalogProduct);
    }

    if (!vendorId) {
      throw new Error(
        `BigCommerce order product ${productId} (${normalizeString(orderProduct.sku) ?? 'no-sku'}) is not mapped to a supplier vendor.`,
      );
    }

    const lineKey = `bc-line-${orderProduct.id}`;
    const vendorLineItem: VendorOrderLineItem = {
      vendor_id: vendorId,
      bigcommerce_product_id: productId,
      vendor_product_id: fallbackMap?.vendor_product_id ?? null,
      line_key: lineKey,
      order_product: orderProduct,
      supplier_product_id: normalizeString(fallbackMap?.vendor_product_id) ?? String(productId),
      supplier_part_id:
        normalizeString(orderProduct.sku)
        ?? normalizeString(fallbackMap?.sku)
        ?? String(productId),
    };

    const existingGroup = groupsByVendorId.get(vendorId);
    if (existingGroup) {
      existingGroup.vendor_line_items.push(vendorLineItem);
      existingGroup.line_count = existingGroup.vendor_line_items.length;
      continue;
    }

    groupsByVendorId.set(vendorId, {
      vendor_id: vendorId,
      purchase_order_number: buildVendorPurchaseOrderNumber(input.externalOrderId, vendorId),
      line_count: 1,
      vendor_line_items: [vendorLineItem],
    });
  }

  const groups = Array.from(groupsByVendorId.values());
  groups.sort((left, right) => left.vendor_id - right.vendor_id);

  // Force eager validation that overrides only point at known line keys.
  const knownLineKeys = new Set(groups.flatMap(group => group.vendor_line_items.map(item => item.line_key)));
  for (const override of input.overrides?.line_item_overrides ?? []) {
    if (!knownLineKeys.has(override.line_key)) {
      throw new Error(`Line override "${override.line_key}" does not match any BigCommerce order line.`);
    }
    hasConfigurationOverride(input.overrides, override.line_key);
  }

  return groups;
}
