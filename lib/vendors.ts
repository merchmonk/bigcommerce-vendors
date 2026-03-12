import { getPool } from './db';

export type ApiServiceType = 'SOAP' | 'REST' | 'RPC' | 'XML' | 'JSON';

export interface PromoEndpointConfig {
  enabled: boolean;
  version: string | null;
}

export interface Vendor {
  vendor_id: number;
  vendor_name: string;
  vendor_api_url: string | null;
  vendor_account_id: string | null;
  vendor_secret: string | null;
  is_promo_standards: boolean;
  promo_endpoints: Record<string, PromoEndpointConfig> | null;
  format_data: string | null;
  api_service_type: ApiServiceType | null;
  is_active: boolean;
  datetime_added: string;
  datetime_modified: string;
}

export interface VendorInput {
  vendor_name: string;
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  is_promo_standards: boolean;
  promo_endpoints?: Record<string, PromoEndpointConfig> | null;
  format_data?: string | null;
  api_service_type?: ApiServiceType | null;
  is_active?: boolean;
}

async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const pool = await getPool();
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function listVendors(includeInactive = false): Promise<Vendor[]> {
  const rows = await query<Vendor>(
    `SELECT * FROM vendors ${includeInactive ? '' : 'WHERE is_active = TRUE'} ORDER BY vendor_name ASC`,
  );
  return rows;
}

export async function getVendorById(vendorId: number): Promise<Vendor | null> {
  const rows = await query<Vendor>('SELECT * FROM vendors WHERE vendor_id = $1', [vendorId]);
  return rows[0] ?? null;
}

export async function createVendor(input: VendorInput): Promise<Vendor> {
  const rows = await query<Vendor>(
    `
    INSERT INTO vendors
      (vendor_name, vendor_api_url, vendor_account_id, vendor_secret, is_promo_standards,
       promo_endpoints, format_data, api_service_type, is_active, datetime_added, datetime_modified)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, TRUE), NOW(), NOW())
    RETURNING *
    `,
    [
      input.vendor_name,
      input.vendor_api_url ?? null,
      input.vendor_account_id ?? null,
      input.vendor_secret ?? null,
      input.is_promo_standards,
      input.promo_endpoints ?? null,
      input.format_data ?? null,
      input.api_service_type ?? null,
      input.is_active ?? true,
    ],
  );
  return rows[0];
}

export async function updateVendor(vendorId: number, input: Partial<VendorInput>): Promise<Vendor | null> {
  const existing = await getVendorById(vendorId);
  if (!existing) return null;

  const merged: VendorInput = {
    vendor_name: input.vendor_name ?? existing.vendor_name,
    vendor_api_url: input.vendor_api_url ?? existing.vendor_api_url ?? undefined,
    vendor_account_id: input.vendor_account_id ?? existing.vendor_account_id ?? undefined,
    vendor_secret: input.vendor_secret ?? existing.vendor_secret ?? undefined,
    is_promo_standards: input.is_promo_standards ?? existing.is_promo_standards,
    promo_endpoints: input.promo_endpoints ?? (existing.promo_endpoints as any) ?? null,
    format_data: input.format_data ?? existing.format_data ?? null,
    api_service_type: input.api_service_type ?? (existing.api_service_type as ApiServiceType | null) ?? null,
    is_active: input.is_active ?? existing.is_active,
  };

  const rows = await query<Vendor>(
    `
    UPDATE vendors
    SET
      vendor_name = $1,
      vendor_api_url = $2,
      vendor_account_id = $3,
      vendor_secret = $4,
      is_promo_standards = $5,
      promo_endpoints = $6,
      format_data = $7,
      api_service_type = $8,
      is_active = $9,
      datetime_modified = NOW()
    WHERE vendor_id = $10
    RETURNING *
    `,
    [
      merged.vendor_name,
      merged.vendor_api_url ?? null,
      merged.vendor_account_id ?? null,
      merged.vendor_secret ?? null,
      merged.is_promo_standards,
      merged.promo_endpoints ?? null,
      merged.format_data ?? null,
      merged.api_service_type ?? null,
      merged.is_active ?? true,
      vendorId,
    ],
  );

  return rows[0] ?? null;
}

export async function deactivateVendor(vendorId: number): Promise<void> {
  await query(
    `
    UPDATE vendors
    SET is_active = FALSE, datetime_modified = NOW()
    WHERE vendor_id = $1
    `,
    [vendorId],
  );
}

export async function deleteVendor(vendorId: number): Promise<void> {
  await query('DELETE FROM vendors WHERE vendor_id = $1', [vendorId]);
}

