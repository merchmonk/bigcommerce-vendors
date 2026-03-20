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

function stringifyValue(value: Record<string, unknown>): string {
  return JSON.stringify(value);
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
}): Promise<void> {
  const existing = (await listProductMetafields(input.accessToken, input.storeHash, input.productId)).find(
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
      `${buildApiBase(input.storeHash)}/catalog/products/${input.productId}/metafields/${existing.id}`,
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
  variantDesignerOverrides: Array<{
    sku: string;
    value: Record<string, unknown>;
  }>;
  variantIdsBySku: Map<string, number>;
}): Promise<void> {
  const namespace = process.env.BIGCOMMERCE_PRODUCT_CONTRACT_NAMESPACE?.trim() || 'merchmonk';
  const productKey = process.env.BIGCOMMERCE_PRODUCT_DESIGNER_DEFAULTS_KEY?.trim() || 'product_designer_defaults';
  const variantKey = process.env.BIGCOMMERCE_VARIANT_DESIGNER_OVERRIDE_KEY?.trim() || 'variant_designer_override';

  await upsertProductMetafield({
    accessToken: input.accessToken,
    storeHash: input.storeHash,
    productId: input.productId,
    namespace,
    key: productKey,
    value: input.productDesignerDefaults,
  });

  const overridesBySku = new Map(input.variantDesignerOverrides.map(item => [item.sku, item.value]));

  for (const [sku, variantId] of Array.from(input.variantIdsBySku.entries())) {
    const overrideValue = overridesBySku.get(sku);
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
