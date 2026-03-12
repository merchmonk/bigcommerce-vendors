import type { ApiServiceType, PromoEndpointConfig } from '../lib/vendors';

export interface VendorFormData {
  vendor_name: string;
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  is_promo_standards: boolean;
  promo_endpoints?: Record<string, PromoEndpointConfig> | null;
  format_data?: string | null;
  api_service_type?: ApiServiceType | null;
}

