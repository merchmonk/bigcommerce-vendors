import type { NormalizedProduct } from './productNormalizer';
import {
  canonicalizeTaxonomyName,
  classifyDuplicateDecision,
  derivePercentBulkPricingRulesFromCost,
  deriveSellingPrice,
  parseMarkupPercent,
  type ProductCandidate,
} from './syncSemantics';

interface BigCommerceCatalogProduct {
  id: number;
  sku: string;
  name: string;
  custom_fields?: Array<{ name: string; value: string }>;
}

interface BigCommerceCatalogResponse<T> {
  data: T;
}

interface BigCommerceCatalogListResponse<T> extends BigCommerceCatalogResponse<T[]> {}

interface BigCommerceBrand {
  id: number;
  name: string;
}

interface BigCommerceCategory {
  id: number;
  name: string;
  parent_id: number;
}

interface BigCommerceVariant {
  id: number;
  sku: string;
}

interface BigCommerceOptionValue {
  id: number;
  label: string;
}

interface BigCommerceProductOption {
  id: number;
  display_name: string;
  option_values?: BigCommerceOptionValue[];
}

interface BigCommerceBulkPricingRule {
  id: number;
}

interface BigCommerceModifier {
  id: number;
  display_name: string;
}

export interface UpsertBigCommerceProductInput {
  accessToken: string;
  storeHash: string;
  vendorId: number;
  product: NormalizedProduct;
  defaultMarkupPercent?: number;
}

export interface UpsertBigCommerceProductResult {
  product: BigCommerceCatalogProduct;
  duplicate: boolean;
  action: 'create' | 'update';
  resolvedSku: string;
  markupPercent: number;
}

function buildApiBase(storeHash: string): string {
  return `https://api.bigcommerce.com/stores/${storeHash}/v3`;
}

function createHeaders(accessToken: string): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Auth-Token': accessToken,
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

async function requestJson<T>(
  accessToken: string,
  url: string,
  options: RequestInit,
  errorMessage: string,
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...createHeaders(accessToken),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`${errorMessage} (${response.status}): ${errorBody}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return parseJson<T>(response);
}

function dedupeProducts(products: BigCommerceCatalogProduct[]): BigCommerceCatalogProduct[] {
  return products.filter(
    (product, index) => products.findIndex(candidate => candidate.id === product.id) === index,
  );
}

function readVendorMarker(product: BigCommerceCatalogProduct): string | undefined {
  const field = (product.custom_fields ?? []).find(item => item.name === 'vendor_id');
  return field?.value?.trim() || undefined;
}

function toCandidate(product: BigCommerceCatalogProduct): ProductCandidate {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    vendor_marker: readVendorMarker(product),
  };
}

async function listProductsBySku(
  accessToken: string,
  storeHash: string,
  sku: string,
): Promise<BigCommerceCatalogProduct[]> {
  const url = `${buildApiBase(storeHash)}/catalog/products?sku=${encodeURIComponent(sku)}&include=custom_fields&limit=250`;
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceCatalogProduct>>(
    accessToken,
    url,
    { method: 'GET' },
    'Failed to list BigCommerce products by SKU',
  );
  return response.data ?? [];
}

async function listProductsByName(
  accessToken: string,
  storeHash: string,
  name: string,
): Promise<BigCommerceCatalogProduct[]> {
  const url = `${buildApiBase(storeHash)}/catalog/products?name=${encodeURIComponent(name)}&include=custom_fields&limit=250`;
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceCatalogProduct>>(
    accessToken,
    url,
    { method: 'GET' },
    'Failed to list BigCommerce products by name',
  );
  return (response.data ?? []).filter(item => item.name === name);
}

async function listProductCandidates(
  accessToken: string,
  storeHash: string,
  product: NormalizedProduct,
): Promise<BigCommerceCatalogProduct[]> {
  const bySku = await listProductsBySku(accessToken, storeHash, product.sku);
  const byName = await listProductsByName(accessToken, storeHash, product.name);
  return dedupeProducts([...bySku, ...byName]);
}

async function resolveAvailableSku(
  accessToken: string,
  storeHash: string,
  desiredSku: string,
  currentProductId?: number,
): Promise<string> {
  let candidate = desiredSku;
  let attempt = 0;
  while (attempt < 30) {
    const matches = await listProductsBySku(accessToken, storeHash, candidate);
    const hasCollision = matches.some(product => product.id !== currentProductId);
    if (!hasCollision) {
      return candidate;
    }
    attempt += 1;
    candidate = `${desiredSku}_${attempt}`;
  }
  throw new Error(`Unable to find available SKU for ${desiredSku}`);
}

function dedupeCustomFields(fields: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
  return fields.filter(
    (field, index) => fields.findIndex(item => item.name === field.name && item.value === field.value) === index,
  );
}

function withSharedFields(
  product: NormalizedProduct,
  input: {
    vendorId: number;
    duplicate: boolean;
    markupPercent: number;
  },
): Array<{ name: string; value: string }> {
  const existing = product.custom_fields ?? [];
  const withoutReserved = existing.filter(
    field => !['vendor_id', 'duplicate', 'size', 'product_cost_markup'].includes(field.name),
  );
  return dedupeCustomFields([
    ...withoutReserved,
    { name: 'vendor_id', value: String(input.vendorId) },
    { name: 'duplicate', value: input.duplicate ? 'true' : 'false' },
    ...(product.shared_option_values?.size ? [{ name: 'size', value: product.shared_option_values.size }] : []),
    { name: 'product_cost_markup', value: String(input.markupPercent) },
  ]);
}

function buildBigCommercePayload(
  product: NormalizedProduct,
  options: {
    brandId?: number;
    categoryIds?: number[];
    includeVariants?: boolean;
    sku: string;
    markupPercent: number;
    duplicate: boolean;
    vendorId: number;
  },
): Record<string, unknown> {
  const baseCost = product.cost_price ?? product.price ?? 0;
  const basePrice = deriveSellingPrice(baseCost, options.markupPercent) ?? product.price ?? 0;

  const variantPayload = (product.variants ?? [])
    .filter(variant => (variant.option_values ?? []).length > 0)
    .map(variant => {
      const variantCost = variant.cost_price ?? variant.price ?? baseCost;
      return {
        sku: variant.sku,
        cost_price: variantCost,
        price: deriveSellingPrice(variantCost, options.markupPercent) ?? basePrice,
        inventory_level: variant.inventory_level ?? product.inventory_level ?? 0,
        option_values: variant.option_values,
      };
    });

  const bulkPricingRules = derivePercentBulkPricingRulesFromCost({
    base_cost_price: baseCost,
    vendor_rules: product.bulk_pricing_rules,
  });

  return {
    name: product.name,
    type: 'physical',
    sku: options.sku,
    description: product.description ?? '',
    cost_price: baseCost,
    price: basePrice,
    inventory_tracking: 'product',
    inventory_level: product.inventory_level ?? 0,
    search_keywords: product.search_keywords ?? undefined,
    custom_fields: withSharedFields(product, {
      vendorId: options.vendorId,
      duplicate: options.duplicate,
      markupPercent: options.markupPercent,
    }),
    ...(options?.brandId ? { brand_id: options.brandId } : {}),
    ...(options?.categoryIds && options.categoryIds.length > 0 ? { categories: options.categoryIds } : {}),
    ...(product.images && product.images.length > 0 ? { images: product.images } : {}),
    ...(bulkPricingRules && bulkPricingRules.length > 0 ? { bulk_pricing_rules: bulkPricingRules } : {}),
    ...(options?.includeVariants && variantPayload.length > 0 ? { variants: variantPayload } : {}),
  };
}

async function ensureBrandId(
  accessToken: string,
  storeHash: string,
  brandName: string | undefined,
): Promise<number | undefined> {
  if (!brandName) return undefined;
  const canonicalBrand = canonicalizeTaxonomyName(brandName);

  const brandsResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceBrand>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/brands?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce brands',
  );
  const existingBrand = (brandsResponse.data ?? []).find(
    brand => canonicalizeTaxonomyName(brand.name) === canonicalBrand,
  );
  if (existingBrand) return existingBrand.id;

  const created = await requestJson<BigCommerceCatalogResponse<BigCommerceBrand>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/brands`,
    {
      method: 'POST',
      body: JSON.stringify({ name: brandName }),
    },
    'Failed to create BigCommerce brand',
  );
  return created.data.id;
}

function parseCategoryPath(category: string): string[] {
  return category
    .split('>')
    .map(value => value.trim())
    .filter(Boolean);
}

async function ensureCategoryPath(
  accessToken: string,
  storeHash: string,
  categoryPath: string,
  categoryCache: BigCommerceCategory[],
): Promise<number | undefined> {
  const parts = parseCategoryPath(categoryPath);
  if (parts.length === 0) return undefined;

  let parentId = 0;
  let leafId: number | undefined;
  for (const part of parts) {
    const canonicalPart = canonicalizeTaxonomyName(part);
    const existing = categoryCache.find(
      category =>
        category.parent_id === parentId &&
        canonicalizeTaxonomyName(category.name) === canonicalPart,
    );
    if (existing) {
      parentId = existing.id;
      leafId = existing.id;
      continue;
    }

    const created = await requestJson<BigCommerceCatalogResponse<BigCommerceCategory>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/categories`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: part,
          parent_id: parentId,
          is_visible: true,
        }),
      },
      'Failed to create BigCommerce category',
    );
    categoryCache.push(created.data);
    parentId = created.data.id;
    leafId = created.data.id;
  }

  return leafId;
}

async function ensureCategoryIds(
  accessToken: string,
  storeHash: string,
  categories: string[] | undefined,
): Promise<number[] | undefined> {
  if (!categories || categories.length === 0) return undefined;

  const listResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceCategory>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/categories?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce categories',
  );
  const categoryCache = [...(listResponse.data ?? [])];
  const categoryIds: number[] = [];
  for (const categoryPath of categories) {
    const categoryId = await ensureCategoryPath(accessToken, storeHash, categoryPath, categoryCache);
    if (!categoryId) continue;
    if (!categoryIds.includes(categoryId)) {
      categoryIds.push(categoryId);
    }
  }

  return categoryIds.length > 0 ? categoryIds : undefined;
}

async function ensureVariantOptions(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
): Promise<void> {
  const variants = product.variants ?? [];
  if (variants.length === 0) return;

  const optionsNeeded = new Map<string, Set<string>>();
  for (const variant of variants) {
    for (const option of variant.option_values ?? []) {
      const key = option.option_display_name.trim();
      const label = option.label.trim();
      if (!key || !label) continue;
      const labels = optionsNeeded.get(key) ?? new Set<string>();
      labels.add(label);
      optionsNeeded.set(key, labels);
    }
  }
  if (optionsNeeded.size === 0) return;

  const optionsResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceProductOption>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/options?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product options',
  );
  const existingOptions = optionsResponse.data ?? [];

  for (const [displayName, labelsSet] of Array.from(optionsNeeded.entries())) {
    const labels = Array.from(labelsSet);
    const existingOption = existingOptions.find(
      option => option.display_name.toLowerCase() === displayName.toLowerCase(),
    );

    if (!existingOption) {
      await requestJson<BigCommerceCatalogResponse<BigCommerceProductOption>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/options`,
        {
          method: 'POST',
          body: JSON.stringify({
            display_name: displayName,
            type: 'radio_buttons',
            option_values: labels.map(label => ({ label })),
          }),
        },
        'Failed to create BigCommerce product option',
      );
      continue;
    }

    const existingLabels = new Set(
      (existingOption.option_values ?? []).map(optionValue => optionValue.label.toLowerCase()),
    );
    for (const label of labels) {
      if (existingLabels.has(label.toLowerCase())) continue;
      try {
        await requestJson<BigCommerceCatalogResponse<BigCommerceOptionValue>>(
          accessToken,
          `${buildApiBase(storeHash)}/catalog/products/${productId}/options/${existingOption.id}/values`,
          {
            method: 'POST',
            body: JSON.stringify({ label }),
          },
          'Failed to create BigCommerce product option value',
        );
      } catch {
        // Option values can already exist under strict duplicate checks.
      }
    }
  }
}

async function syncVariants(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
  markupPercent: number,
): Promise<void> {
  const variants = (product.variants ?? []).filter(variant => variant.option_values.length > 0);
  if (variants.length === 0) return;

  await ensureVariantOptions(accessToken, storeHash, productId, product);

  const existingVariantsResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceVariant>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/variants?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce variants',
  );
  const existingBySku = new Map(
    (existingVariantsResponse.data ?? []).map(variant => [variant.sku, variant]),
  );

  for (const variant of variants) {
    const variantCost = variant.cost_price ?? variant.price ?? product.cost_price ?? product.price ?? 0;
    const payload = {
      sku: variant.sku,
      cost_price: variantCost,
      price: deriveSellingPrice(variantCost, markupPercent) ?? variant.price ?? product.price ?? 0,
      inventory_level: variant.inventory_level ?? product.inventory_level ?? 0,
      option_values: variant.option_values,
    };
    const existing = existingBySku.get(variant.sku);
    if (existing) {
      await requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
        accessToken,
        `${buildApiBase(storeHash)}/catalog/products/${productId}/variants/${existing.id}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
        'Failed to update BigCommerce variant',
      );
      continue;
    }

    await requestJson<BigCommerceCatalogResponse<BigCommerceVariant>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/variants`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Failed to create BigCommerce variant',
    );
  }
}

async function syncBulkPricingRules(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
): Promise<void> {
  const existingRulesResponse = await requestJson<BigCommerceCatalogListResponse<BigCommerceBulkPricingRule>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/bulk-pricing-rules`,
    { method: 'GET' },
    'Failed to list BigCommerce bulk pricing rules',
  );

  for (const rule of existingRulesResponse.data ?? []) {
    await requestJson<Record<string, unknown>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/bulk-pricing-rules/${rule.id}`,
      { method: 'DELETE' },
      'Failed to delete existing BigCommerce bulk pricing rule',
    );
  }

  const baseCost = product.cost_price ?? product.price;
  const newRules = derivePercentBulkPricingRulesFromCost({
    base_cost_price: baseCost,
    vendor_rules: product.bulk_pricing_rules,
  }) ?? [];
  for (const rule of newRules) {
    const payload: Record<string, unknown> = {
      quantity_min: rule.quantity_min,
      type: rule.type,
      amount: rule.amount,
    };
    if (typeof rule.quantity_max === 'number') {
      payload.quantity_max = rule.quantity_max;
    }

    await requestJson<Record<string, unknown>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/bulk-pricing-rules`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      'Failed to create BigCommerce bulk pricing rule',
    );
  }
}

async function listProductModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceModifier[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceModifier>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers?limit=250`,
    { method: 'GET' },
    'Failed to list product modifiers',
  );
  return response.data ?? [];
}

async function ensureModifier(
  accessToken: string,
  storeHash: string,
  productId: number,
  input: {
    display_name: string;
    option_values: Array<{ label: string; adjuster_value?: number }>;
  },
): Promise<void> {
  const existingModifiers = await listProductModifiers(accessToken, storeHash, productId);
  const existing = existingModifiers.find(
    modifier => modifier.display_name.toLowerCase() === input.display_name.toLowerCase(),
  );

  if (existing) {
    await requestJson<Record<string, unknown>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers/${existing.id}`,
      {
        method: 'PUT',
        body: JSON.stringify({
          display_name: input.display_name,
          type: 'dropdown',
          option_values: input.option_values.map((value, index) => ({
            label: value.label,
            sort_order: index,
            is_default: index === 0,
            ...(value.adjuster_value !== undefined
              ? {
                  adjusters: {
                    price: {
                      adjuster: 'relative',
                      adjuster_value: value.adjuster_value,
                    },
                  },
                }
              : {}),
          })),
        }),
      },
      'Failed to update product modifier',
    );
    return;
  }

  await requestJson<Record<string, unknown>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers`,
    {
      method: 'POST',
      body: JSON.stringify({
        display_name: input.display_name,
        type: 'dropdown',
        required: false,
        option_values: input.option_values.map((value, index) => ({
          label: value.label,
          sort_order: index,
          is_default: index === 0,
          ...(value.adjuster_value !== undefined
            ? {
                adjusters: {
                  price: {
                    adjuster: 'relative',
                    adjuster_value: value.adjuster_value,
                  },
                },
              }
            : {}),
        })),
      }),
    },
    'Failed to create product modifier',
  );
}

async function ensureSharedOptionModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
  input: {
    vendorId: number;
    duplicate: boolean;
    size?: string;
    markupPercent: number;
  },
): Promise<void> {
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'vendor_id',
    option_values: [{ label: String(input.vendorId) }],
  });
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'duplicate',
    option_values: [{ label: input.duplicate ? 'true' : 'false' }],
  });
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'product_cost_markup',
    option_values: [{ label: String(input.markupPercent) }],
  });
  if (input.size) {
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'size',
      option_values: [{ label: input.size }],
    });
  }
}

function buildModifierCounts(min?: number, max?: number): number[] {
  const floorMin = min && min > 0 ? Math.floor(min) : 1;
  const floorMax = max && max >= floorMin ? Math.floor(max) : floorMin;
  const span = floorMax - floorMin;
  if (span > 15) return [floorMin, floorMax];
  const values: number[] = [];
  for (let value = floorMin; value <= floorMax; value += 1) {
    values.push(value);
  }
  return values;
}

async function ensureConfigurationModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
  product: NormalizedProduct,
): Promise<void> {
  const blueprint = product.modifier_blueprint;
  if (!blueprint || blueprint.locations.length === 0) return;

  const locationValues = blueprint.locations.map(location => ({ label: location.location }));
  await ensureModifier(accessToken, storeHash, productId, {
    display_name: 'Decoration Location',
    option_values: locationValues,
  });

  const methods = blueprint.locations.flatMap(location =>
    location.methods.map(method => ({
      label: `${location.location}: ${method.method}`,
      adjuster_value: method.charge_amount,
    })),
  );
  if (methods.length > 0) {
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'Decoration Method',
      option_values: methods,
    });
  }

  const min = Math.min(
    ...blueprint.locations
      .map(location => location.min_decorations)
      .filter((value): value is number => value !== undefined),
  );
  const max = Math.max(
    ...blueprint.locations
      .map(location => location.max_decorations)
      .filter((value): value is number => value !== undefined),
  );
  if (Number.isFinite(min) || Number.isFinite(max)) {
    const counts = buildModifierCounts(Number.isFinite(min) ? min : 1, Number.isFinite(max) ? max : 1);
    await ensureModifier(accessToken, storeHash, productId, {
      display_name: 'Decoration Count',
      option_values: counts.map(count => {
        const charge = blueprint.charges.find(item => item.count === count);
        return {
          label: String(count),
          adjuster_value: charge?.amount,
        };
      }),
    });
  }
}

export async function upsertBigCommerceProduct(
  input: UpsertBigCommerceProductInput,
): Promise<UpsertBigCommerceProductResult> {
  const candidates = await listProductCandidates(input.accessToken, input.storeHash, input.product);
  const decision = classifyDuplicateDecision({
    source_sku: input.product.sku,
    source_name: input.product.name,
    vendor_id: input.vendorId,
    candidates: candidates.map(toCandidate),
  });

  const markupPercent = parseMarkupPercent(
    input.product.shared_option_values?.product_cost_markup,
    input.defaultMarkupPercent ?? 30,
  );

  const resolvedSku = await resolveAvailableSku(
    input.accessToken,
    input.storeHash,
    decision.resolved_sku,
    decision.target_product_id,
  );
  const brandId = await ensureBrandId(input.accessToken, input.storeHash, input.product.brand_name);
  const categoryIds = await ensureCategoryIds(input.accessToken, input.storeHash, input.product.categories);

  const createPayload = buildBigCommercePayload(input.product, {
    brandId,
    categoryIds,
    includeVariants: true,
    sku: resolvedSku,
    markupPercent,
    duplicate: decision.duplicate,
    vendorId: input.vendorId,
  });
  const updatePayload = buildBigCommercePayload(input.product, {
    brandId,
    categoryIds,
    includeVariants: false,
    sku: resolvedSku,
    markupPercent,
    duplicate: decision.duplicate,
    vendorId: input.vendorId,
  });

  if (decision.action === 'create' || !decision.target_product_id) {
    const created = await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/catalog/products`,
      {
        method: 'POST',
        body: JSON.stringify(createPayload),
      },
      'Failed to create BigCommerce product',
    );

    await syncVariants(input.accessToken, input.storeHash, created.data.id, input.product, markupPercent);
    await syncBulkPricingRules(input.accessToken, input.storeHash, created.data.id, input.product);
    await ensureSharedOptionModifiers(input.accessToken, input.storeHash, created.data.id, {
      vendorId: input.vendorId,
      duplicate: decision.duplicate,
      size: input.product.shared_option_values?.size,
      markupPercent,
    });
    await ensureConfigurationModifiers(input.accessToken, input.storeHash, created.data.id, input.product);

    return {
      product: {
        ...created.data,
        sku: resolvedSku,
      },
      duplicate: decision.duplicate,
      action: 'create',
      resolvedSku,
      markupPercent,
    };
  }

  const updated = await requestJson<BigCommerceCatalogResponse<BigCommerceCatalogProduct>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${decision.target_product_id}`,
    {
      method: 'PUT',
      body: JSON.stringify(updatePayload),
    },
    'Failed to update BigCommerce product',
  );

  await syncVariants(input.accessToken, input.storeHash, decision.target_product_id, input.product, markupPercent);
  await syncBulkPricingRules(input.accessToken, input.storeHash, decision.target_product_id, input.product);
  await ensureSharedOptionModifiers(input.accessToken, input.storeHash, decision.target_product_id, {
    vendorId: input.vendorId,
    duplicate: decision.duplicate,
    size: input.product.shared_option_values?.size,
    markupPercent,
  });
  await ensureConfigurationModifiers(input.accessToken, input.storeHash, decision.target_product_id, input.product);

  return {
    product: {
      ...updated.data,
      sku: resolvedSku,
    },
    duplicate: decision.duplicate,
    action: 'update',
    resolvedSku,
    markupPercent,
  };
}

export async function upsertRelatedProducts(input: {
  accessToken: string;
  storeHash: string;
  sourceProductId: number;
  targetProductIds: number[];
}): Promise<void> {
  if (input.targetProductIds.length === 0) return;

  const existingResponse = await requestJson<BigCommerceCatalogListResponse<{ related_product_id?: number; id?: number }>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.sourceProductId}/related-products?limit=250`,
    { method: 'GET' },
    'Failed to list related products',
  );
  const existing = new Set(
    (existingResponse.data ?? [])
      .map(row => row.related_product_id ?? row.id)
      .filter((value): value is number => typeof value === 'number'),
  );

  for (const relatedProductId of input.targetProductIds) {
    if (existing.has(relatedProductId)) continue;
    try {
      await requestJson<Record<string, unknown>>(
        input.accessToken,
        `${buildApiBase(input.storeHash)}/catalog/products/${input.sourceProductId}/related-products`,
        {
          method: 'POST',
          body: JSON.stringify({ related_product_id: relatedProductId }),
        },
        'Failed to create related product link',
      );
    } catch {
      // Duplicate or validation race can happen when sync runs overlap.
    }
  }
}
