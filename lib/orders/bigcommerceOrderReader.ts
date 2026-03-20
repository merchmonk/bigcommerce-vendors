import { requestJson } from '../etl/bigcommerceApi';
import type {
  BigCommerceCatalogOrderContextProduct,
  BigCommerceOrder,
  BigCommerceOrderBundle,
  BigCommerceOrderProduct,
  BigCommerceOrderShippingAddress,
} from './bigcommerceOrderTypes';

function buildOrdersV2Base(storeHash: string): string {
  return `https://api.bigcommerce.com/stores/${storeHash}/v2`;
}

export async function getBigCommerceOrder(input: {
  accessToken: string;
  storeHash: string;
  orderId: number;
}): Promise<BigCommerceOrder> {
  return requestJson<BigCommerceOrder>(
    input.accessToken,
    `${buildOrdersV2Base(input.storeHash)}/orders/${input.orderId}`,
    { method: 'GET' },
    'Failed to load BigCommerce order',
  );
}

export async function listBigCommerceOrderProducts(input: {
  accessToken: string;
  storeHash: string;
  orderId: number;
}): Promise<BigCommerceOrderProduct[]> {
  return requestJson<BigCommerceOrderProduct[]>(
    input.accessToken,
    `${buildOrdersV2Base(input.storeHash)}/orders/${input.orderId}/products`,
    { method: 'GET' },
    'Failed to list BigCommerce order products',
  );
}

export async function listBigCommerceOrderShippingAddresses(input: {
  accessToken: string;
  storeHash: string;
  orderId: number;
}): Promise<BigCommerceOrderShippingAddress[]> {
  return requestJson<BigCommerceOrderShippingAddress[]>(
    input.accessToken,
    `${buildOrdersV2Base(input.storeHash)}/orders/${input.orderId}/shipping_addresses`,
    { method: 'GET' },
    'Failed to list BigCommerce order shipping addresses',
  );
}

export async function getBigCommerceCatalogOrderContextProduct(input: {
  accessToken: string;
  storeHash: string;
  productId: number;
}): Promise<BigCommerceCatalogOrderContextProduct> {
  const response = await requestJson<{ data: BigCommerceCatalogOrderContextProduct }>(
    input.accessToken,
    `https://api.bigcommerce.com/stores/${input.storeHash}/v3/catalog/products/${input.productId}?include=custom_fields`,
    { method: 'GET' },
    'Failed to load BigCommerce order product context',
  );

  return response.data;
}

export async function hydrateBigCommerceOrder(input: {
  accessToken: string;
  storeHash: string;
  orderId: number;
}): Promise<BigCommerceOrderBundle> {
  const [order, products, shippingAddresses] = await Promise.all([
    getBigCommerceOrder(input),
    listBigCommerceOrderProducts(input),
    listBigCommerceOrderShippingAddresses(input),
  ]);

  return {
    order,
    products,
    shippingAddresses,
  };
}
