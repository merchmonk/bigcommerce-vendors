import {
  BigCommerceCatalogListResponse,
  BigCommerceCatalogResponse,
  buildApiBase,
  buildApiV2Base,
  requestJson,
} from '../etl/bigcommerceApi';
import { listProductMetafields, listVariantMetafields } from '../etl/bigcommerceMetafields';

export interface BigCommerceRuntimeImage {
  url_standard?: string;
  url_zoom?: string;
  description?: string;
  is_thumbnail?: boolean;
}

export interface BigCommerceRuntimeCustomField {
  name: string;
  value: string;
}

export interface BigCommerceRuntimeProduct {
  id: number;
  name: string;
  sku: string;
  description?: string;
  price?: number;
  search_keywords?: string;
  brand_id?: number;
  categories?: number[];
  inventory_tracking?: string;
  custom_url?: {
    url?: string;
  };
  base_variant_id?: number;
  related_products?: string | number[];
  custom_fields?: BigCommerceRuntimeCustomField[];
  images?: BigCommerceRuntimeImage[];
  primary_image?: BigCommerceRuntimeImage;
}

export interface BigCommerceRuntimeVariant {
  id: number;
  sku: string;
  price?: number;
  cost_price?: number;
  inventory_level?: number | null;
  image_url?: string;
  option_values?: Array<{
    option_display_name: string;
    label: string;
  }>;
}

export interface BigCommerceRuntimeModifier {
  id: number;
  display_name: string;
  option_values?: Array<{
    id?: number;
    label?: string;
  }>;
}

export interface BigCommerceRuntimeBrand {
  id: number;
  name: string;
}

export interface BigCommerceRuntimeCategory {
  id: number;
  name: string;
}

export interface BigCommerceRuntimeMetafield {
  id: number;
  namespace: string;
  key: string;
  value?: string;
}

export interface BigCommerceDesignerRuntimeBundle {
  product: BigCommerceRuntimeProduct;
  variants: BigCommerceRuntimeVariant[];
  modifiers: BigCommerceRuntimeModifier[];
  relatedProducts: BigCommerceRuntimeProduct[];
  brand?: BigCommerceRuntimeBrand;
  categories: BigCommerceRuntimeCategory[];
  productMetafields: BigCommerceRuntimeMetafield[];
  variantMetafields: BigCommerceRuntimeMetafield[];
}

async function getProduct(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceRuntimeProduct> {
  const response = await requestJson<BigCommerceCatalogResponse<BigCommerceRuntimeProduct>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}?include=custom_fields,images`,
    { method: 'GET' },
    'Failed to load BigCommerce product',
  );
  return response.data;
}

async function listVariants(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceRuntimeVariant[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceRuntimeVariant>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/variants?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product variants',
  );
  return response.data ?? [];
}

async function listModifiers(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceRuntimeModifier[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceRuntimeModifier>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/products/${productId}/modifiers?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce product modifiers',
  );
  return response.data ?? [];
}

async function listRelatedProductIds(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<number[]> {
  const response = await requestJson<{ related_products?: string | number[] }>(
    accessToken,
    `${buildApiV2Base(storeHash)}/products/${productId}`,
    { method: 'GET' },
    'Failed to load BigCommerce related products',
  );

  if (Array.isArray(response.related_products)) {
    return response.related_products.filter((id): id is number => typeof id === 'number');
  }

  if (typeof response.related_products !== 'string') {
    return [];
  }

  return response.related_products
    .split(',')
    .map(item => Number(item.trim()))
    .filter(id => Number.isInteger(id) && id > 0);
}

async function getBrand(
  accessToken: string,
  storeHash: string,
  brandId: number,
): Promise<BigCommerceRuntimeBrand | undefined> {
  try {
    const response = await requestJson<BigCommerceCatalogResponse<BigCommerceRuntimeBrand>>(
      accessToken,
      `${buildApiBase(storeHash)}/catalog/brands/${brandId}`,
      { method: 'GET' },
      'Failed to load BigCommerce brand',
    );
    return response.data;
  } catch {
    return undefined;
  }
}

async function listAllCategories(
  accessToken: string,
  storeHash: string,
): Promise<BigCommerceRuntimeCategory[]> {
  const response = await requestJson<BigCommerceCatalogListResponse<BigCommerceRuntimeCategory>>(
    accessToken,
    `${buildApiBase(storeHash)}/catalog/categories?limit=250`,
    { method: 'GET' },
    'Failed to list BigCommerce categories',
  );
  return response.data ?? [];
}

async function getProductBestEffort(
  accessToken: string,
  storeHash: string,
  productId: number,
): Promise<BigCommerceRuntimeProduct | null> {
  try {
    return await getProduct(accessToken, storeHash, productId);
  } catch {
    return null;
  }
}

export async function loadBigCommerceDesignerRuntimeBundle(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
  variantId: number;
}): Promise<BigCommerceDesignerRuntimeBundle> {
  const [product, variants, modifiers, relatedProductIds] = await Promise.all([
    getProduct(input.accessToken, input.storeHash, input.productId),
    listVariants(input.accessToken, input.storeHash, input.productId),
    listModifiers(input.accessToken, input.storeHash, input.productId),
    listRelatedProductIds(input.accessToken, input.storeHash, input.productId),
  ]);

  const selectedVariant = variants.find(variant => variant.id === input.variantId);
  if (!selectedVariant) {
    throw new Error(`Variant ${input.variantId} does not belong to product ${input.productId}.`);
  }

  const [brand, allCategories, productMetafields, variantMetafields, relatedProducts] = await Promise.all([
    product.brand_id ? getBrand(input.accessToken, input.storeHash, product.brand_id) : Promise.resolve(undefined),
    product.categories && product.categories.length > 0
      ? listAllCategories(input.accessToken, input.storeHash)
      : Promise.resolve([]),
    listProductMetafields(input.accessToken, input.storeHash, input.productId),
    listVariantMetafields(input.accessToken, input.storeHash, input.productId, input.variantId),
    Promise.all(
      relatedProductIds
        .map(relatedProductId => getProductBestEffort(input.accessToken, input.storeHash, relatedProductId)),
    ).then(products => products.filter((product): product is BigCommerceRuntimeProduct => !!product)),
  ]);

  const categorySet = new Set(product.categories ?? []);
  const categories = allCategories.filter(category => categorySet.has(category.id));

  return {
    product,
    variants,
    modifiers,
    relatedProducts,
    brand,
    categories,
    productMetafields,
    variantMetafields,
  };
}
