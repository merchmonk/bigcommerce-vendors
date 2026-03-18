import type { EndpointMapping, MappingProtocol, VendorEndpointMapping } from '../../types';
import type { Vendor } from '../vendors';
import { resolveEndpointAdapter } from './adapters/factory';
import type {
  ModifierCharge,
  NormalizedBulkPricingRule,
  NormalizedProduct,
  ProductModifierBlueprint,
} from './productNormalizer';

type AssignedMapping = VendorEndpointMapping & { mapping: EndpointMapping };
type AnyRecord = Record<string, unknown>;

export interface ProductEndpointResult {
  mapping_id: number;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  status: number;
  products_found: number;
  message?: string;
}

export interface ProductAssemblyStatus {
  sku: string;
  vendor_product_id?: string;
  blocked: boolean;
  gating_reasons: string[];
  enrichment_status: NonNullable<NormalizedProduct['enrichment_status']>;
}

export interface MediaRetryMarker {
  sku: string;
  vendor_product_id: string;
  message: string;
}

export interface ProductAssemblyResult {
  products: NormalizedProduct[];
  endpointResults: ProductEndpointResult[];
  statuses: ProductAssemblyStatus[];
  mediaRetries: MediaRetryMarker[];
}

const DEFAULT_LOCALIZATION_COUNTRY = 'US';
const DEFAULT_LOCALIZATION_LANGUAGE = 'en';

const INVENTORY_KEYS = ['quantityAvailable', 'inventory', 'Inventory', 'qty', 'Qty', 'quantity', 'Quantity'];
const PRICE_KEYS = ['price', 'Price', 'netPrice', 'NetPrice', 'listPrice', 'ListPrice', 'partPrice', 'PartPrice'];
const MIN_KEYS = ['quantityMin', 'qtyMin', 'minimumQuantity', 'minQty'];
const MAX_KEYS = ['quantityMax', 'qtyMax', 'maximumQuantity', 'maxQty'];
const LOCATION_KEYS = ['locationName', 'locationId', 'id', 'name'];
const METHOD_KEYS = ['decorationMethod', 'decorationMethodName', 'method', 'methodName', 'chargeName'];
const CHARGE_KEYS = ['chargePrice', 'price', 'Price', 'amount', 'Amount', 'value'];

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): AnyRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as AnyRecord;
}

function readStringConfig(config: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function resolveProtocol(mappingProtocol: string | null | undefined, vendorProtocol: string | null | undefined): MappingProtocol {
  if (mappingProtocol) return mappingProtocol as MappingProtocol;
  if (vendorProtocol) return vendorProtocol as MappingProtocol;
  return 'SOAP';
}

function walkNodes(value: unknown, callback: (node: AnyRecord) => void): void {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => walkNodes(item, callback));
    return;
  }
  if (typeof value !== 'object') return;

  const node = value as AnyRecord;
  callback(node);
  Object.values(node).forEach(child => walkNodes(child, callback));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function getFirstString(node: AnyRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function getFirstNumber(node: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = toNumber(node[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function dedupeUrls(urls: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const value = url.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function dedupeBulkRules(rules: NormalizedBulkPricingRule[]): NormalizedBulkPricingRule[] {
  return rules.filter(
    (rule, index) =>
      rules.findIndex(
        item =>
          item.quantity_min === rule.quantity_min &&
          item.quantity_max === rule.quantity_max &&
          item.amount === rule.amount &&
          item.type === rule.type,
      ) === index,
  );
}

function getEndpointUrl(vendor: Vendor, runtimeConfig: Record<string, unknown>): string {
  const runtimeEndpointUrl = readStringConfig(runtimeConfig, ['endpoint_url', 'endpointUrl']);
  if (runtimeEndpointUrl) return runtimeEndpointUrl;
  return vendor.vendor_api_url ?? '';
}

function mergeRequestFields(
  runtimeConfig: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const existing = asRecord(runtimeConfig.request_fields);
  return {
    ...runtimeConfig,
    request_fields: {
      ...existing,
      ...fields,
    },
  };
}

function buildBaseRequestFields(product: NormalizedProduct): Record<string, unknown> {
  return {
    productId: product.vendor_product_id ?? product.sku,
    partId: product.source_sku ?? product.sku,
    localizationCountry: DEFAULT_LOCALIZATION_COUNTRY,
    localizationLanguage: DEFAULT_LOCALIZATION_LANGUAGE,
  };
}

function extractInventoryLevel(payload: unknown): number | undefined {
  const quantities: number[] = [];
  walkNodes(payload, node => {
    const number = getFirstNumber(node, INVENTORY_KEYS);
    if (number !== undefined) {
      quantities.push(number);
    }
  });
  if (quantities.length === 0) return undefined;
  return quantities.reduce((sum, value) => sum + value, 0);
}

function extractImages(payload: unknown): Array<{ image_url: string; is_thumbnail?: boolean }> {
  const urls: string[] = [];
  walkNodes(payload, node => {
    Object.values(node).forEach(value => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed.startsWith('http')) return;
      if (!/\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(trimmed) && !trimmed.toLowerCase().includes('image')) return;
      urls.push(trimmed);
    });
  });
  const unique = dedupeUrls(urls);
  return unique.map((url, index) => ({
    image_url: url,
    ...(index === 0 ? { is_thumbnail: true } : {}),
  }));
}

function extractBulkRules(payload: unknown): NormalizedBulkPricingRule[] {
  const tiers: NormalizedBulkPricingRule[] = [];
  walkNodes(payload, node => {
    const quantityMin = getFirstNumber(node, MIN_KEYS);
    const price = getFirstNumber(node, PRICE_KEYS);
    if (quantityMin === undefined || price === undefined) return;
    const quantityMax = getFirstNumber(node, MAX_KEYS);
    tiers.push({
      quantity_min: quantityMin,
      quantity_max: quantityMax,
      type: 'price',
      amount: price,
    });
  });
  return dedupeBulkRules(tiers).sort((a, b) => a.quantity_min - b.quantity_min);
}

function extractCharges(payload: unknown): ModifierCharge[] {
  const charges: ModifierCharge[] = [];
  walkNodes(payload, node => {
    const amount = getFirstNumber(node, CHARGE_KEYS);
    if (amount === undefined) return;

    charges.push({
      location: getFirstString(node, LOCATION_KEYS),
      method: getFirstString(node, METHOD_KEYS),
      amount,
      code: getFirstString(node, ['chargeId', 'code', 'chargeCode']),
      type: getFirstString(node, ['chargeType', 'type']),
      count: getFirstNumber(node, ['decorations', 'decorationCount', 'count']),
    });
  });
  return charges;
}

function extractModifierBlueprint(payloads: unknown[]): ProductModifierBlueprint | undefined {
  const locations = new Map<string, {
    location: string;
    min_decorations?: number;
    max_decorations?: number;
    included_decorations?: number;
    methods: Set<string>;
  }>();
  const charges: ModifierCharge[] = [];

  for (const payload of payloads) {
    walkNodes(payload, node => {
      const locationName = getFirstString(node, LOCATION_KEYS);
      const methodName = getFirstString(node, METHOD_KEYS);
      if (locationName) {
        const existing = locations.get(locationName) ?? {
          location: locationName,
          methods: new Set<string>(),
        };
        const minDecorations = getFirstNumber(node, ['minDecorations', 'minimumDecorations', 'decorationsMin']);
        const maxDecorations = getFirstNumber(node, ['maxDecorations', 'maximumDecorations', 'decorationsMax']);
        const includedDecorations = getFirstNumber(node, ['decorationsIncluded', 'includedDecorations']);
        if (minDecorations !== undefined) existing.min_decorations = minDecorations;
        if (maxDecorations !== undefined) existing.max_decorations = maxDecorations;
        if (includedDecorations !== undefined) existing.included_decorations = includedDecorations;
        if (methodName) existing.methods.add(methodName);
        locations.set(locationName, existing);
      }
    });

    charges.push(...extractCharges(payload));
  }

  const locationRows = Array.from(locations.values()).map(location => ({
    location: location.location,
    min_decorations: location.min_decorations,
    max_decorations: location.max_decorations,
    included_decorations: location.included_decorations,
    methods: Array.from(location.methods).map(method => {
      const charge = charges.find(item => item.location === location.location && item.method === method);
      return {
        method,
        charge_amount: charge?.amount,
      };
    }),
  }));

  if (locationRows.length === 0 && charges.length === 0) return undefined;

  return {
    locations: locationRows,
    charges,
  };
}

function extractPricingCost(payloads: unknown[], fallback?: number): number | undefined {
  const candidates: number[] = [];
  for (const payload of payloads) {
    walkNodes(payload, node => {
      const cost = getFirstNumber(node, PRICE_KEYS);
      if (cost !== undefined && cost >= 0) {
        candidates.push(cost);
      }
    });
  }
  if (candidates.length === 0) return fallback;
  return candidates.sort((a, b) => a - b)[0];
}

async function runProductOperation(input: {
  vendor: Vendor;
  mapping: AssignedMapping;
  product: NormalizedProduct;
}): Promise<{ status: number; parsedBody: Record<string, unknown> | null; message?: string }> {
  const mapping = input.mapping.mapping;
  const runtimeConfig = asRecord(input.mapping.runtime_config) ?? {};
  const endpointUrl = getEndpointUrl(input.vendor, runtimeConfig);
  if (!endpointUrl) {
    return {
      status: 400,
      parsedBody: null,
      message: 'Missing endpoint URL for product enrichment call.',
    };
  }

  const protocol = resolveProtocol(mapping.protocol, input.vendor.api_protocol);
  const adapter = resolveEndpointAdapter(protocol);
  const operationName = (mapping.operation_name ?? '').trim();
  if (!operationName) {
    return {
      status: 400,
      parsedBody: null,
      message: 'Missing operation name for product enrichment call.',
    };
  }

  const runtime = mergeRequestFields(runtimeConfig, buildBaseRequestFields(input.product));
  const result = await adapter.invokeEndpoint({
    endpointUrl,
    operationName,
    endpointVersion: mapping.endpoint_version,
    vendorAccountId: input.vendor.vendor_account_id,
    vendorSecret: input.vendor.vendor_secret,
    runtimeConfig: runtime,
  });

  return {
    status: result.status,
    parsedBody: result.parsedBody,
  };
}

function ensureEnrichmentStatus(
  product: NormalizedProduct,
): NonNullable<NormalizedProduct['enrichment_status']> {
  if (product.enrichment_status) return product.enrichment_status;
  return {
    pricing: 'MISSING',
    inventory: 'MISSING',
    media: 'MISSING',
    gating_reasons: [],
    media_errors: [],
  };
}

function filterByEndpoint(
  mappings: AssignedMapping[],
  endpointName: string,
): AssignedMapping[] {
  return mappings.filter(item => item.mapping.endpoint_name === endpointName);
}

function addEndpointResult(
  results: ProductEndpointResult[],
  mapping: EndpointMapping,
  status: number,
  productsFound: number,
  message?: string,
): void {
  results.push({
    mapping_id: mapping.mapping_id,
    endpoint_name: mapping.endpoint_name,
    endpoint_version: mapping.endpoint_version,
    operation_name: mapping.operation_name,
    status,
    products_found: productsFound,
    ...(message ? { message } : {}),
  });
}

export async function buildProductAssembly(input: {
  vendor: Vendor;
  assignedMappings: AssignedMapping[];
  baseProducts: NormalizedProduct[];
}): Promise<ProductAssemblyResult> {
  const endpointResults: ProductEndpointResult[] = [];
  const assembled: NormalizedProduct[] = [];
  const statuses: ProductAssemblyStatus[] = [];
  const mediaRetries: MediaRetryMarker[] = [];

  const inventoryMappings = filterByEndpoint(input.assignedMappings, 'Inventory');
  const pricingMappings = filterByEndpoint(input.assignedMappings, 'PricingAndConfiguration');
  const mediaMappings = filterByEndpoint(input.assignedMappings, 'ProductMedia');

  for (const base of input.baseProducts) {
    const product: NormalizedProduct = {
      ...base,
      enrichment_status: ensureEnrichmentStatus(base),
    };

    const gatingReasons: string[] = [];
    const pricingPayloads: unknown[] = [];
    const mediaPayloads: unknown[] = [];

    if (pricingMappings.length === 0) {
      product.enrichment_status!.pricing = 'MISSING';
    } else {
      let pricingFailed = false;
      for (const mapping of pricingMappings) {
        try {
          const result = await runProductOperation({
            vendor: input.vendor,
            mapping,
            product,
          });
          if (result.status >= 400 || !result.parsedBody) {
            pricingFailed = true;
            addEndpointResult(
              endpointResults,
              mapping.mapping,
              result.status,
              0,
              result.message ?? 'Pricing call failed',
            );
            continue;
          }

          pricingPayloads.push(result.parsedBody);
          addEndpointResult(endpointResults, mapping.mapping, result.status, 1);
        } catch (error: any) {
          pricingFailed = true;
          addEndpointResult(endpointResults, mapping.mapping, 500, 0, error?.message ?? 'Pricing call failed');
        }
      }

      if (pricingFailed) {
        product.enrichment_status!.pricing = 'FAILED';
        gatingReasons.push('PricingAndConfiguration enrichment failed.');
      } else {
        product.enrichment_status!.pricing = 'SUCCESS';
      }
    }

    if (inventoryMappings.length === 0) {
      product.enrichment_status!.inventory = 'MISSING';
    } else {
      let inventoryFailed = false;
      let inventoryLevel: number | undefined;

      for (const mapping of inventoryMappings) {
        try {
          const result = await runProductOperation({
            vendor: input.vendor,
            mapping,
            product,
          });
          if (result.status >= 400 || !result.parsedBody) {
            inventoryFailed = true;
            addEndpointResult(endpointResults, mapping.mapping, result.status, 0, result.message ?? 'Inventory call failed');
            continue;
          }

          const extracted = extractInventoryLevel(result.parsedBody);
          if (extracted !== undefined) {
            inventoryLevel = extracted;
          }
          addEndpointResult(endpointResults, mapping.mapping, result.status, extracted !== undefined ? 1 : 0);
        } catch (error: any) {
          inventoryFailed = true;
          addEndpointResult(endpointResults, mapping.mapping, 500, 0, error?.message ?? 'Inventory call failed');
        }
      }

      if (inventoryFailed) {
        product.enrichment_status!.inventory = 'FAILED';
        gatingReasons.push('Inventory enrichment failed.');
      } else {
        product.enrichment_status!.inventory = 'SUCCESS';
        if (inventoryLevel !== undefined) {
          product.inventory_level = inventoryLevel;
        }
      }
    }

    if (mediaMappings.length === 0) {
      product.enrichment_status!.media = 'MISSING';
    } else {
      let mediaFailed = false;
      for (const mapping of mediaMappings) {
        try {
          const result = await runProductOperation({
            vendor: input.vendor,
            mapping,
            product,
          });
          if (result.status >= 400 || !result.parsedBody) {
            mediaFailed = true;
            addEndpointResult(endpointResults, mapping.mapping, result.status, 0, result.message ?? 'Media call failed');
            continue;
          }
          mediaPayloads.push(result.parsedBody);
          addEndpointResult(endpointResults, mapping.mapping, result.status, 1);
        } catch (error: any) {
          mediaFailed = true;
          addEndpointResult(endpointResults, mapping.mapping, 500, 0, error?.message ?? 'Media call failed');
        }
      }

      if (mediaFailed) {
        product.enrichment_status!.media = 'FAILED';
        const message = `Media enrichment failed for ${product.vendor_product_id ?? product.sku}.`;
        product.enrichment_status!.media_errors = [...(product.enrichment_status!.media_errors ?? []), message];
        if (product.vendor_product_id) {
          mediaRetries.push({
            sku: product.sku,
            vendor_product_id: product.vendor_product_id,
            message,
          });
        }
      } else {
        product.enrichment_status!.media = 'SUCCESS';
      }
    }

    if (pricingPayloads.length > 0) {
      const extractedCost = extractPricingCost(pricingPayloads, product.cost_price ?? product.price);
      if (extractedCost !== undefined) {
        product.cost_price = extractedCost;
      }
      const extractedBulkRules = pricingPayloads.flatMap(payload => extractBulkRules(payload));
      if (extractedBulkRules.length > 0) {
        product.bulk_pricing_rules = dedupeBulkRules(extractedBulkRules);
      }
      const blueprint = extractModifierBlueprint(pricingPayloads);
      if (blueprint) {
        product.modifier_blueprint = blueprint;
      }
    }

    if (mediaPayloads.length > 0) {
      const images = mediaPayloads.flatMap(payload => extractImages(payload));
      if (images.length > 0) {
        const deduped = dedupeUrls(images.map(image => image.image_url)).map((url, index) => ({
          image_url: url,
          ...(index === 0 ? { is_thumbnail: true } : {}),
        }));
        product.images = deduped;
      }
    }

    const blocked = gatingReasons.length > 0;
    product.enrichment_status!.gating_reasons = gatingReasons;
    statuses.push({
      sku: product.sku,
      vendor_product_id: product.vendor_product_id,
      blocked,
      gating_reasons: gatingReasons,
      enrichment_status: product.enrichment_status!,
    });

    if (!blocked) {
      assembled.push(product);
    }
  }

  return {
    products: assembled,
    endpointResults,
    statuses,
    mediaRetries,
  };
}
