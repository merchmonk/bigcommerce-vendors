import type { EndpointMapping, MappingProtocol, VendorEndpointMapping } from '../../types';
import type { Vendor } from '../vendors';
import { resolveEndpointAdapter } from './adapters/factory';
import {
  applyPricingConfigurationToProduct,
  buildProductPricingConfiguration,
} from './pricingConfiguration';
import type {
  ModifierCharge,
  NormalizedBulkPricingRule,
  NormalizedMediaAsset,
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
const PRODUCT_MEDIA_TYPES = ['Image'] as const; //removed 'Video' for the time being

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

function dedupeMediaAssets(assets: NormalizedMediaAsset[]): NormalizedMediaAsset[] {
  const seen = new Set<string>();
  const output: NormalizedMediaAsset[] = [];

  for (const asset of assets) {
    const key = [
      asset.media_type,
      asset.url.trim(),
      asset.part_id ?? '',
      (asset.location_ids ?? []).join('|'),
      (asset.decoration_ids ?? []).join('|'),
    ].join('::');
    if (!asset.url.trim() || seen.has(key)) continue;
    seen.add(key);
    output.push(asset);
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

function buildBaseRequestFields(
  product: NormalizedProduct,
  options?: {
    includePartId?: boolean;
  },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    productId: product.vendor_product_id ?? product.sku,
    localizationCountry: DEFAULT_LOCALIZATION_COUNTRY,
    localizationLanguage: DEFAULT_LOCALIZATION_LANGUAGE,
  };

  if (options?.includePartId !== false) {
    fields.partId = product.source_sku ?? product.sku;
  }

  return fields;
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

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function extractSoapFaultMessage(parsedBody: Record<string, unknown> | null, rawPayload: string): string {
  const fault = parsedBody?.Fault;
  if (fault && typeof fault === 'object') {
    const faultRecord = fault as Record<string, unknown>;
    const faultString = faultRecord.faultstring;
    if (typeof faultString === 'string' && faultString.trim()) {
      return faultString.trim();
    }
  }

  const match = rawPayload.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  return match?.[1]?.trim() ?? '';
}

function readResponseMessage(parsedBody: Record<string, unknown> | null, rawPayload: string): string | undefined {
  const faultMessage = extractSoapFaultMessage(parsedBody, rawPayload);
  if (faultMessage) return faultMessage;

  const errorMessage = asRecord(parsedBody?.errorMessage);
  const description = typeof errorMessage?.description === 'string' ? errorMessage.description.trim() : '';
  if (description) return description;

  return undefined;
}

function readMediaType(value: unknown): 'Image' | 'Video' | undefined {
  if (value === 'Image' || value === 'Video') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'image') return 'Image';
  if (normalized === 'video') return 'Video';
  return undefined;
}

function extractIdentifierList(
  value: unknown,
  nestedKey: string,
  candidateKeys: string[],
): string[] {
  const values: string[] = [];

  const collectFromValue = (target: unknown): void => {
    if (target === null || target === undefined) return;

    if (Array.isArray(target)) {
      target.forEach(item => collectFromValue(item));
      return;
    }

    const record = asRecord(target);
    if (record) {
      const direct = getFirstString(record, candidateKeys);
      if (direct) {
        values.push(direct);
      }
      Object.values(record).forEach(item => collectFromValue(item));
      return;
    }

    if (typeof target === 'string' && target.trim()) {
      values.push(target.trim());
      return;
    }

    if (typeof target === 'number') {
      values.push(String(target));
    }
  };

  walkNodes(value, node => {
    if (nestedKey && !Object.hasOwn(node, nestedKey)) {
      return;
    }

    const target = nestedKey ? node[nestedKey] : node;
    collectFromValue(target);
  });

  return dedupeUrls(values);
}

function extractClassTypes(value: unknown): string[] | undefined {
  const classes = extractIdentifierList(value, 'ClassType', ['classType', 'value', 'name']);
  return classes.length > 0 ? classes : undefined;
}

function extractLocationIds(value: unknown): string[] | undefined {
  const ids = extractIdentifierList(value, 'Location', ['locationId', 'id', 'locationName', 'name']);
  return ids.length > 0 ? ids : undefined;
}

function extractDecorationIds(value: unknown, fallbackDecorationId?: string): string[] | undefined {
  const ids = extractIdentifierList(value, 'Decoration', ['decorationId', 'id', 'decorationName', 'name']);
  if (fallbackDecorationId) {
    ids.push(fallbackDecorationId);
  }
  const unique = dedupeUrls(ids);
  return unique.length > 0 ? unique : undefined;
}

function extractMediaContentNodes(payload: unknown): AnyRecord[] {
  const entries: AnyRecord[] = [];
  walkNodes(payload, node => {
    if (!Object.hasOwn(node, 'url')) return;
    const url = typeof node.url === 'string' ? node.url.trim() : '';
    if (!url) return;
    entries.push(node);
  });
  return entries;
}

function extractMediaAssets(payload: unknown): NormalizedMediaAsset[] {
  const assets: NormalizedMediaAsset[] = [];

  for (const node of extractMediaContentNodes(payload)) {
    const url = typeof node.url === 'string' ? node.url.trim() : '';
    const mediaType = readMediaType(node.mediaType) ?? (/\.(mp4|mov|webm)(\?|$)/i.test(url) ? 'Video' : 'Image');
    if (!url || !mediaType) continue;

    const classTypes = extractClassTypes(node.ClassTypeArray);
    const locationIds = extractLocationIds(node.LocationArray);
    const decorationId = getFirstString(node, ['decorationId']);
    const decorationIds = extractDecorationIds(node.DecorationArray, decorationId);
    const partId = getFirstString(node, ['partId', 'PartID', 'partID']);
    const description = getFirstString(node, ['description', 'Description']);
    const color = getFirstString(node, ['color', 'Color']);
    const singlePart = toBoolean(node.singlePart);
    const changeTimestamp = getFirstString(node, ['changeTimeStamp', 'changeTimestamp']);
    const width = getFirstNumber(node, ['width', 'Width']);
    const height = getFirstNumber(node, ['height', 'Height']);
    const dpi = getFirstNumber(node, ['dpi', 'DPI']);

    assets.push({
      url,
      media_type: mediaType,
      ...(partId ? { part_id: partId } : {}),
      ...(locationIds ? { location_ids: locationIds } : {}),
      ...(decorationIds ? { decoration_ids: decorationIds } : {}),
      ...(description ? { description } : {}),
      ...(classTypes ? { class_types: classTypes } : {}),
      ...(color ? { color } : {}),
      ...(singlePart !== undefined ? { single_part: singlePart } : {}),
      ...(changeTimestamp ? { change_timestamp: changeTimestamp } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(dpi !== undefined ? { dpi } : {}),
    });
  }

  return dedupeMediaAssets(assets);
}

function buildImageGalleryFromAssets(assets: NormalizedMediaAsset[]): Array<{ image_url: string; is_thumbnail?: boolean }> {
  const imageUrls = dedupeUrls(
    assets
      .filter(asset => asset.media_type === 'Image')
      .map(asset => asset.url),
  );

  return imageUrls.map((url, index) => ({
    image_url: url,
    ...(index === 0 ? { is_thumbnail: true } : {}),
  }));
}

function collectKnownPartIds(product: NormalizedProduct): string[] {
  const partIds = [
    ...(product.variants ?? []).map(variant => variant.part_id ?? variant.source_sku),
    product.source_sku,
  ].filter((value): value is string => !!value?.trim());

  return dedupeUrls(partIds);
}

function shouldRetryMediaByPartId(message: string | undefined): boolean {
  if (!message) return false;
  return /partid/i.test(message) && /required|missing|not found/i.test(message);
}

function shouldSkipMediaAsNoResults(message: string | undefined): boolean {
  if (!message) return false;
  return /no result found/i.test(message);
}

async function loadMediaAssetsForType(input: {
  vendor: Vendor;
  mapping: AssignedMapping;
  product: NormalizedProduct;
  mediaType: 'Image'; //| 'Video';
  endpointResults: ProductEndpointResult[];
}): Promise<{ assets: NormalizedMediaAsset[]; failed: boolean }> {
  const knownPartIds = collectKnownPartIds(input.product);
  const assets: NormalizedMediaAsset[] = [];
  let failed = false;

  const productLevelResult = await runProductOperation({
    vendor: input.vendor,
    mapping: input.mapping,
    product: input.product,
    requestFields: { mediaType: input.mediaType },
  });

  if (productLevelResult.status >= 400) {
    if (shouldRetryMediaByPartId(productLevelResult.message) && knownPartIds.length > 0) {
      addEndpointResult(
        input.endpointResults,
        input.mapping.mapping,
        productLevelResult.status,
        0,
        productLevelResult.message,
      );
    } else {
      addEndpointResult(
        input.endpointResults,
        input.mapping.mapping,
        productLevelResult.status,
        0,
        productLevelResult.message ?? `${input.mediaType} media call failed`,
      );
      return { assets: [], failed: true };
    }
  } else if (productLevelResult.parsedBody) {
    const productAssets = extractMediaAssets(productLevelResult.parsedBody).filter(
      asset => asset.media_type === input.mediaType,
    );
    assets.push(...productAssets);
    addEndpointResult(
      input.endpointResults,
      input.mapping.mapping,
      productLevelResult.status,
      productAssets.length,
      shouldSkipMediaAsNoResults(productLevelResult.message) ? productLevelResult.message : undefined,
    );

    const seenPartIds = new Set(
      productAssets
        .map(asset => asset.part_id)
        .filter((value): value is string => !!value),
    );
    const missingPartIds = knownPartIds.filter(partId => !seenPartIds.has(partId));
    const shouldFanOut =
      knownPartIds.length > 0 &&
      missingPartIds.length > 0 &&
      (shouldRetryMediaByPartId(productLevelResult.message) ||
        (productAssets.length > 0 && (seenPartIds.size > 0 || missingPartIds.length === knownPartIds.length)));

    if (!shouldFanOut) {
      return { assets: dedupeMediaAssets(assets), failed: false };
    }

    for (const partId of missingPartIds) {
      const partResult = await runProductOperation({
        vendor: input.vendor,
        mapping: input.mapping,
        product: input.product,
        requestFields: {
          mediaType: input.mediaType,
          partId,
        },
      });

      if (partResult.status >= 400 || !partResult.parsedBody) {
        if (shouldSkipMediaAsNoResults(partResult.message)) {
          addEndpointResult(
            input.endpointResults,
            input.mapping.mapping,
            partResult.status,
            0,
            partResult.message,
          );
          continue;
        }

        failed = true;
        addEndpointResult(
          input.endpointResults,
          input.mapping.mapping,
          partResult.status,
          0,
          partResult.message ?? `${input.mediaType} part media call failed`,
        );
        continue;
      }

      const partAssets = extractMediaAssets(partResult.parsedBody).filter(
        asset => asset.media_type === input.mediaType,
      );
      assets.push(...partAssets);
      addEndpointResult(
        input.endpointResults,
        input.mapping.mapping,
        partResult.status,
        partAssets.length,
        shouldSkipMediaAsNoResults(partResult.message) ? partResult.message : undefined,
      );
    }

    return { assets: dedupeMediaAssets(assets), failed };
  }

  for (const partId of knownPartIds) {
    const partResult = await runProductOperation({
      vendor: input.vendor,
      mapping: input.mapping,
      product: input.product,
      requestFields: {
        mediaType: input.mediaType,
        partId,
      },
    });

    if (partResult.status >= 400 || !partResult.parsedBody) {
      if (shouldSkipMediaAsNoResults(partResult.message)) {
        addEndpointResult(
          input.endpointResults,
          input.mapping.mapping,
          partResult.status,
          0,
          partResult.message,
        );
        continue;
      }

      failed = true;
      addEndpointResult(
        input.endpointResults,
        input.mapping.mapping,
        partResult.status,
        0,
        partResult.message ?? `${input.mediaType} part media call failed`,
      );
      continue;
    }

    const partAssets = extractMediaAssets(partResult.parsedBody).filter(asset => asset.media_type === input.mediaType);
    assets.push(...partAssets);
    addEndpointResult(
      input.endpointResults,
      input.mapping.mapping,
      partResult.status,
      partAssets.length,
      shouldSkipMediaAsNoResults(partResult.message) ? partResult.message : undefined,
    );
  }

  return { assets: dedupeMediaAssets(assets), failed };
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
  requestFields?: Record<string, unknown>;
}): Promise<{ status: number; parsedBody: Record<string, unknown> | null; message?: string; rawPayload: string }> {
  const mapping = input.mapping.mapping;
  const runtimeConfig = asRecord(input.mapping.runtime_config) ?? {};
  const endpointUrl = getEndpointUrl(input.vendor, runtimeConfig);
  if (!endpointUrl) {
    return {
      status: 400,
      parsedBody: null,
      message: 'Missing endpoint URL for product enrichment call.',
      rawPayload: '',
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
      rawPayload: '',
    };
  }

  const shouldOmitPartId =
    input.mapping.mapping.endpoint_name === 'PricingAndConfiguration' &&
    input.mapping.mapping.operation_name === 'getConfigurationAndPricing' &&
    (input.product.variants?.length ?? 0) > 0;
  const runtime = mergeRequestFields(
    runtimeConfig,
    {
      ...buildBaseRequestFields(input.product, {
        includePartId: !shouldOmitPartId,
      }),
      ...(input.requestFields ?? {}),
    },
  );
  const result = await adapter.invokeEndpoint({
    endpointUrl,
    endpointName: mapping.endpoint_name,
    operationName,
    endpointVersion: mapping.endpoint_version,
    vendorAccountId: input.vendor.vendor_account_id,
    vendorSecret: input.vendor.vendor_secret,
    runtimeConfig: runtime,
  });

  return {
    status: result.status,
    parsedBody: result.parsedBody,
    rawPayload: result.rawPayload,
    message: readResponseMessage(result.parsedBody, result.rawPayload),
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

function filterByEndpointOperation(
  mappings: AssignedMapping[],
  endpointName: string,
  operationName: string,
): AssignedMapping[] {
  return mappings.filter(
    item =>
      item.mapping.endpoint_name === endpointName &&
      (item.mapping.operation_name ?? '').trim() === operationName,
  );
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
  const mediaMappings = filterByEndpointOperation(input.assignedMappings, 'ProductMedia', 'getMediaContent');

  for (const base of input.baseProducts) {
    const product: NormalizedProduct = {
      ...base,
      enrichment_status: ensureEnrichmentStatus(base),
    };

    const gatingReasons: string[] = [];
    const pricingPayloads: unknown[] = [];
    const mediaAssets: NormalizedMediaAsset[] = [];

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
        for (const mediaType of PRODUCT_MEDIA_TYPES) {
          try {
            const result = await loadMediaAssetsForType({
              vendor: input.vendor,
              mapping,
              product,
              mediaType,
              endpointResults,
            });
            mediaAssets.push(...result.assets);
            if (result.failed) {
              mediaFailed = true;
            }
          } catch (error: any) {
            mediaFailed = true;
            addEndpointResult(
              endpointResults,
              mapping.mapping,
              500,
              0,
              error?.message ?? `${mediaType} media call failed`,
            );
          }
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
      const pricingConfiguration = buildProductPricingConfiguration(pricingPayloads);
      if (pricingConfiguration) {
        Object.assign(product, applyPricingConfigurationToProduct(product, pricingConfiguration));
      }

      const extractedCost = extractPricingCost(pricingPayloads, product.cost_price ?? product.price);
      if (extractedCost !== undefined) {
        product.cost_price = extractedCost;
        product.price = product.price ?? extractedCost;
      }
      const extractedBulkRules = pricingPayloads.flatMap(payload => extractBulkRules(payload));
      if (extractedBulkRules.length > 0 && (!product.bulk_pricing_rules || product.bulk_pricing_rules.length === 0)) {
        product.bulk_pricing_rules = dedupeBulkRules(extractedBulkRules);
      }
      const blueprint = extractModifierBlueprint(pricingPayloads);
      if (blueprint) {
        product.modifier_blueprint = blueprint;
      }
    }

    if (mediaAssets.length > 0) {
      product.media_assets = dedupeMediaAssets(mediaAssets);
      const structuredImages = buildImageGalleryFromAssets(product.media_assets);
      if (structuredImages.length > 0) {
        product.images = structuredImages;
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
