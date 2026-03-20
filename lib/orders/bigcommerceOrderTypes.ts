export interface BigCommerceOrderContactAddress {
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
}

export interface BigCommerceOrder {
  id: number;
  currency_code?: string | null;
  default_currency_code?: string | null;
  date_created?: string | null;
  date_modified?: string | null;
  customer_message?: string | null;
  shipping_cost_ex_tax?: number | string | null;
  subtotal_ex_tax?: number | string | null;
  total_ex_tax?: number | string | null;
  total_tax?: number | string | null;
  billing_address?: BigCommerceOrderContactAddress | null;
}

export interface BigCommerceOrderProduct {
  id: number;
  product_id: number;
  variant_id?: number | null;
  sku?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  base_price?: number | string | null;
  price_ex_tax?: number | string | null;
  total_ex_tax?: number | string | null;
  order_address_id?: number | null;
  product_options?: Array<Record<string, unknown>>;
  configurable_fields?: Array<Record<string, unknown>>;
}

export interface BigCommerceOrderShippingAddress extends BigCommerceOrderContactAddress {
  id: number;
  shipping_method?: string | null;
}

export interface BigCommerceCatalogOrderContextProduct {
  id: number;
  sku?: string | null;
  name?: string | null;
  custom_fields?: Array<{
    id?: number;
    name: string;
    value: string;
  }>;
}

export interface BigCommerceOrderBundle {
  order: BigCommerceOrder;
  products: BigCommerceOrderProduct[];
  shippingAddresses: BigCommerceOrderShippingAddress[];
}

export interface OrderIntakeLineOverride {
  line_key: string;
  request_fields: Record<string, unknown>;
}

export interface OrderIntakeOverrides {
  po_overrides?: Record<string, unknown>;
  line_item_overrides?: OrderIntakeLineOverride[];
}

export interface VendorOrderLineItem {
  vendor_id: number;
  bigcommerce_product_id: number;
  vendor_product_id?: string | null;
  line_key: string;
  order_product: BigCommerceOrderProduct;
  supplier_product_id?: string;
  supplier_part_id?: string;
}

export interface VendorOrderGroup {
  vendor_id: number;
  purchase_order_number: string;
  line_count: number;
  vendor_line_items: VendorOrderLineItem[];
}
