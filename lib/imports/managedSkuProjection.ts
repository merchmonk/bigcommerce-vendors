import type { NormalizedProduct } from '../etl/productNormalizer';

function readManagedIdentifier(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

function hashManagedIdentifier(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100000000;
  }
  return String(hash).padStart(8, '0');
}

function buildTemporaryManagedProductSku(input: {
  vendorId: number;
  product: NormalizedProduct;
  attempt?: number;
}): string {
  const identity = readManagedIdentifier(
    input.product.vendor_product_id,
    input.product.source_sku,
    input.product.sku,
  ) ?? `${input.vendorId}`;
  const suffix = hashManagedIdentifier(`${input.vendorId}:${identity}`);
  return input.attempt && input.attempt > 0
    ? `MMTMP${suffix}_${input.attempt}`
    : `MMTMP${suffix}`;
}

function buildManagedVariantIdentity(input: {
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  };
}): string {
  const optionKey = (input.variant.option_values ?? [])
    .map(optionValue => `${optionValue.option_display_name ?? ''}:${optionValue.label ?? ''}`)
    .join('|');
  return readManagedIdentifier(
    input.variant.part_id,
    input.variant.source_sku,
    input.variant.sku,
    optionKey,
  ) ?? 'variant';
}

function normalizeVariantSkuSegment(value: string | undefined): string {
  const normalized = value?.toUpperCase().replace(/[^A-Z0-9]+/g, '') ?? '';
  if (normalized.length >= 3) {
    return normalized.slice(0, 3);
  }
  if (normalized.length > 0) {
    return normalized.padEnd(3, 'X');
  }
  return 'VAR';
}

function resolveManagedVariantLabel(variant: {
  color?: string;
  size?: string;
  part_id?: string;
  source_sku?: string;
  sku?: string;
  option_values?: Array<{ option_display_name?: string; label?: string }>;
}): string {
  const preferredOptionLabel = (variant.option_values ?? [])
    .filter(optionValue => optionValue.option_display_name?.trim().toLowerCase() !== 'part')
    .map(optionValue => optionValue.label?.trim())
    .find((value): value is string => !!value);

  return (
    preferredOptionLabel ??
    variant.color?.trim() ??
    variant.size?.trim() ??
    variant.part_id?.trim() ??
    variant.source_sku?.trim() ??
    variant.sku?.trim() ??
    'VAR'
  );
}

function buildManagedVariantSkuLookup(input: {
  parentSku: string;
  variants: Array<{
    sku?: string;
    source_sku?: string;
    part_id?: string;
    color?: string;
    size?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  }>;
}): Map<string, string> {
  const lookup = new Map<string, string>();
  const usedSkus = new Set<string>();

  for (const variant of input.variants) {
    const identity = buildManagedVariantIdentity({ variant });
    const segment = normalizeVariantSkuSegment(resolveManagedVariantLabel(variant));
    let candidateSku = `${input.parentSku}-${segment}`;

    if (usedSkus.has(candidateSku)) {
      const hash = hashManagedIdentifier(identity);
      for (let length = 1; length <= hash.length; length += 1) {
        const nextCandidate = `${input.parentSku}-${segment}${hash.slice(0, length)}`;
        if (!usedSkus.has(nextCandidate)) {
          candidateSku = nextCandidate;
          break;
        }
      }
    }

    usedSkus.add(candidateSku);
    lookup.set(identity, candidateSku);
  }

  return lookup;
}

function getManagedVariantSku(input: {
  variantSkuLookup: Map<string, string>;
  variant: {
    sku?: string;
    source_sku?: string;
    part_id?: string;
    option_values?: Array<{ option_display_name?: string; label?: string }>;
  };
}): string {
  return input.variantSkuLookup.get(buildManagedVariantIdentity({ variant: input.variant })) ?? 'MM-VAR';
}

function resolveManagedProductMpn(product: NormalizedProduct): string | undefined {
  return readManagedIdentifier(product.vendor_product_id, product.source_sku, product.sku);
}

function resolveManagedVariantMpn(variant: {
  part_id?: string;
  source_sku?: string;
  sku?: string;
}): string | undefined {
  return readManagedIdentifier(variant.part_id, variant.source_sku, variant.sku);
}

export function buildManagedSkuProjection(input: {
  vendorId: number;
  product: NormalizedProduct;
}): {
  productSku: string;
  productMpn?: string;
  variantSkuBySourceSku: Map<string, string>;
  variantMpnBySourceSku: Map<string, string>;
} {
  const productSku = buildTemporaryManagedProductSku({
    vendorId: input.vendorId,
    product: input.product,
  });
  const storefrontVariants = (input.product.variants ?? []).filter(variant => variant.option_values.length > 0);
  const variantSkuLookup = buildManagedVariantSkuLookup({
    parentSku: productSku,
    variants: storefrontVariants,
  });

  const variantSkuBySourceSku = new Map<string, string>();
  const variantMpnBySourceSku = new Map<string, string>();

  for (const variant of storefrontVariants) {
    const sourceSku = variant.sku;
    if (!sourceSku) continue;
    variantSkuBySourceSku.set(
      sourceSku,
      getManagedVariantSku({
        variantSkuLookup,
        variant,
      }),
    );
    const variantMpn = resolveManagedVariantMpn(variant);
    if (variantMpn) {
      variantMpnBySourceSku.set(sourceSku, variantMpn);
    }
  }

  return {
    productSku,
    productMpn: resolveManagedProductMpn(input.product),
    variantSkuBySourceSku,
    variantMpnBySourceSku,
  };
}
