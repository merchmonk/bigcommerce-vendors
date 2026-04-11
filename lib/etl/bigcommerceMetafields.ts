import {
  BigCommerceCatalogListResponse,
  BigCommerceCatalogResponse,
  buildApiBase,
  requestJson,
} from './bigcommerceApi';

interface BigCommerceMetafield {
  id: number;
  namespace: string;
  key: string;
  value?: string;
  permission_set?: string;
}

type BigCommerceMetafieldPermissionSet =
  | 'app_only'
  | 'read'
  | 'write'
  | 'read_and_sf_access'
  | 'write_and_sf_access';

const INTERNAL_PRODUCT_METAFIELD_PREFIXES = [
  'pricing_configuration_',
  'product_data_',
];
const METAFIELD_VALUE_MAX_BYTES = 65535;
const METAFIELD_CHUNK_KEY_SEPARATOR = '__part_';

function stringifyValue(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

function parseChunkIndex(baseKey: string, key: string): number | null {
  const prefix = `${baseKey}${METAFIELD_CHUNK_KEY_SEPARATOR}`;
  if (!key.startsWith(prefix)) {
    return null;
  }

  const chunkIndexRaw = key.slice(prefix.length).trim();
  if (!/^[1-9]\d*$/.test(chunkIndexRaw)) {
    return null;
  }

  return Number(chunkIndexRaw);
}

function splitUtf8ByByteLimit(value: string, maxBytes: number): string[] {
  if (!value) {
    return [];
  }

  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return [value];
  }

  const chunks: string[] = [];
  let currentChunk = '';
  let currentChunkBytes = 0;

  for (const codePoint of value) {
    const codePointBytes = Buffer.byteLength(codePoint, 'utf8');
    if (codePointBytes > maxBytes) {
      throw new Error('Cannot split metafield payload because a single UTF-8 code point exceeds the byte limit.');
    }

    if (currentChunkBytes + codePointBytes > maxBytes) {
      chunks.push(currentChunk);
      currentChunk = codePoint;
      currentChunkBytes = codePointBytes;
      continue;
    }

    currentChunk += codePoint;
    currentChunkBytes += codePointBytes;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function buildMetafieldChunkKeys(baseKey: string, chunkCount: number): string[] {
  if (chunkCount <= 1) {
    return [baseKey];
  }

  return Array.from({ length: chunkCount }, (_value, index) => `${baseKey}${METAFIELD_CHUNK_KEY_SEPARATOR}${index + 1}`);
}

async function upsertProductMetafieldByString(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  namespace: string;
  key: string;
  value: string;
  existingMetafield?: BigCommerceMetafield;
  permissionSet?: BigCommerceMetafieldPermissionSet;
}): Promise<void> {
  const payload = {
    namespace: input.namespace,
    key: input.key,
    value: input.value,
    permission_set: input.permissionSet ?? 'write_and_sf_access',
  };

  if (input.existingMetafield) {
    await requestJson<BigCommerceCatalogResponse<BigCommerceMetafield>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/metafields/${input.existingMetafield.id}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Failed to update product metafield',
    );
    return;
  }

  await requestJson<BigCommerceCatalogResponse<BigCommerceMetafield>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/metafields`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Failed to create product metafield',
  );
}

export async function listProductMetafields(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceMetafield[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceMetafield>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/metafields?limit=250`,
    { method: 'GET' },
    'Failed to list product metafields',
  );
  return response.data ?? [];
}

export async function listVariantMetafields(
  accessToken: string,
  storeHash: string,
  productId: number,
  variantId: number,
): Promise<BigCommerceMetafield[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceMetafield>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/variants/${variantId}/metafields?limit=250`,
    { method: 'GET' },
    'Failed to list variant metafields',
  );
  return response.data ?? [];
}

async function upsertProductMetafield(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  namespace: string;
  key: string;
  value: Record<string, unknown>;
  permissionSet?: BigCommerceMetafieldPermissionSet;
  /** When provided, skips listing product metafields (caller should list once per product sync). */
  existingProductMetafields?: BigCommerceMetafield[];
}): Promise<void> {
  const existingMetafields =
    input.existingProductMetafields ??
    (await listProductMetafields(input.accessToken, input.storeHash, input.productId));
  const existingByKey = new Map(
    existingMetafields
      .filter(metafield => metafield.namespace === input.namespace)
      .map(metafield => [metafield.key, metafield] as const),
  );

  const valueAsString = stringifyValue(input.value);
  const chunks = splitUtf8ByByteLimit(valueAsString, METAFIELD_VALUE_MAX_BYTES);
  if (chunks.length === 0) {
    throw new Error(`Metafield ${input.namespace}.${input.key} cannot be empty.`);
  }

  const desiredKeys = buildMetafieldChunkKeys(input.key, chunks.length);

  for (let index = 0; index < chunks.length; index += 1) {
    const key = desiredKeys[index];
    const chunk = chunks[index];
    await upsertProductMetafieldByString({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: input.productId,
      namespace: input.namespace,
      key,
      value: chunk,
      existingMetafield: existingByKey.get(key),
      permissionSet: input.permissionSet,
    });
  }

  for (const metafield of existingMetafields) {
    if (metafield.namespace !== input.namespace) {
      continue;
    }

    const chunkIndex = parseChunkIndex(input.key, metafield.key);
    const isBaseKey = metafield.key === input.key;
    if (!isBaseKey && chunkIndex === null) {
      continue;
    }
    if (desiredKeys.includes(metafield.key)) {
      continue;
    }

    await deleteProductMetafield({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: input.productId,
      metafieldId: metafield.id,
    });
  }
}

export function resolveProductMetafieldValue(input: {
  metafields: Array<Pick<BigCommerceMetafield, 'namespace' | 'key' | 'value'>>;
  namespace: string;
  key: string;
}): string | undefined {
  const directMatch = input.metafields.find(
    metafield => metafield.namespace === input.namespace && metafield.key === input.key,
  );
  if (directMatch?.value) {
    return directMatch.value;
  }

  const chunkEntries = input.metafields
    .filter(metafield => metafield.namespace === input.namespace)
    .map(metafield => ({
      chunkIndex: parseChunkIndex(input.key, metafield.key),
      value: metafield.value,
    }))
    .filter(
      (item): item is { chunkIndex: number; value: string } =>
        item.chunkIndex !== null && typeof item.value === 'string' && item.value.length > 0,
    )
    .sort((left, right) => left.chunkIndex - right.chunkIndex);

  if (chunkEntries.length === 0) {
    return undefined;
  }

  for (let index = 0; index < chunkEntries.length; index += 1) {
    if (chunkEntries[index].chunkIndex !== index + 1) {
      return undefined;
    }
  }

  return chunkEntries.map(item => item.value).join('');
}

async function deleteProductMetafield(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  metafieldId: number;
}): Promise<void> {
  await requestJson<Record<string, unknown>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/metafields/${input.metafieldId}`,
    {
      method: 'DELETE',
    },
    'Failed to delete product metafield',
  );
}

async function upsertVariantMetafield(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  variantId: number;
  namespace: string;
  key: string;
  value: Record<string, unknown>;
}): Promise<void> {
  const existing = (await listVariantMetafields(input.accessToken, input.storeHash, input.productId, input.variantId)).find(
    metafield => metafield.namespace === input.namespace && metafield.key === input.key,
  );

  const payload = {
    namespace: input.namespace,
    key: input.key,
    value: stringifyValue(input.value),
    permission_set: 'write_and_sf_access',
  };

  if (existing) {
    await requestJson<BigCommerceCatalogResponse<BigCommerceMetafield>>(
      input.accessToken,
      `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/variants/${input.variantId}/metafields/${existing.id}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      'Failed to update variant metafield',
    );
    return;
  }

  await requestJson<BigCommerceCatalogResponse<BigCommerceMetafield>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/variants/${input.variantId}/metafields`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
    'Failed to create variant metafield',
  );
}

async function deleteVariantMetafield(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  variantId: number;
  metafieldId: number;
}): Promise<void> {
  await requestJson<Record<string, unknown>>(
    input.accessToken,
    `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/variants/${input.variantId}/metafields/${input.metafieldId}`,
    {
      method: 'DELETE',
    },
    'Failed to delete variant metafield',
  );
}

export async function syncProjectedProductContract(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  productDesignerDefaults: Record<string, unknown>;
  productInternalMetafields?: Array<{
    key: string;
    value: Record<string, unknown>;
  }>;
  variantDesignerOverrides: Array<{
    sku: string;
    value: Record<string, unknown>;
  }>;
  variantIdsBySku: Map<string, number>;
}): Promise<void> {
  const namespace = process.env.BIGCOMMERCE_PRODUCT_CONTRACT_NAMESPACE?.trim() || 'merchmonk';
  const productKey = process.env.BIGCOMMERCE_PRODUCT_DESIGNER_DEFAULTS_KEY?.trim() || 'product_designer_defaults';
  const variantKey = process.env.BIGCOMMERCE_VARIANT_DESIGNER_OVERRIDE_KEY?.trim() || 'variant_designer_override';

  const productMetafields = await listProductMetafields(input.accessToken, input.storeHash, input.productId);

  await upsertProductMetafield({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    namespace,
    key: productKey,
    value: input.productDesignerDefaults,
    existingProductMetafields: productMetafields,
  });

  const desiredInternalMetafields = new Map((input.productInternalMetafields ?? []).map(item => [item.key, item.value]));

  for (const [key, value] of Array.from(desiredInternalMetafields.entries())) {
    await upsertProductMetafield({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: input.productId,
      namespace,
      key,
      value,
      permissionSet: 'app_only',
      existingProductMetafields: productMetafields,
    });
  }

  for (const metafield of productMetafields) {
    if (
      metafield.namespace !== namespace ||
      metafield.key === productKey ||
      parseChunkIndex(productKey, metafield.key) !== null ||
      desiredInternalMetafields.has(metafield.key)
    ) {
      continue;
    }

    if (!INTERNAL_PRODUCT_METAFIELD_PREFIXES.some(prefix => metafield.key.startsWith(prefix))) {
      continue;
    }

    await deleteProductMetafield({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: input.productId,
      metafieldId: metafield.id,
    });
  }

  const variantOverrideValuesById = new Map<number, Record<string, unknown>>();

  for (const item of input.variantDesignerOverrides) {
    const variantId = input.variantIdsBySku.get(item.sku);
    if (variantId === undefined || variantOverrideValuesById.has(variantId)) {
      continue;
    }
    variantOverrideValuesById.set(variantId, item.value);
  }

  for (const variantId of Array.from(new Set(input.variantIdsBySku.values()))) {
    const overrideValue = variantOverrideValuesById.get(variantId);
    const existing = await listVariantMetafields(input.accessToken, input.storeHash, input.productId, variantId);
    const existingContractMetafield = existing.find(
      metafield => metafield.namespace === namespace && metafield.key === variantKey,
    );

    if (!overrideValue) {
      if (existingContractMetafield) {
        await deleteVariantMetafield({
          accessToken: input.accessToken,
          storeHash: input.storeHash,
          productId: input.productId,
          variantId,
          metafieldId: existingContractMetafield.id,
        });
      }
      continue;
    }

    await upsertVariantMetafield({
      accessToken: input.accessToken,
      storeHash: input.storeHash,
      productId: input.productId,
      variantId,
      namespace,
      key: variantKey,
      value: overrideValue,
    });
  }
}
