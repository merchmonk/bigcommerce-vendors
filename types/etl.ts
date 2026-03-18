export type MappingStandardType = 'PROMOSTANDARDS' | 'CUSTOM';

export type MappingProtocol = 'SOAP' | 'REST' | 'RPC' | 'XML' | 'JSON';

export type MappingPayloadFormat = 'JSON' | 'XML';

export type SyncScope = 'MAPPING' | 'ALL';

export type SyncRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
export type PendingRelatedLinkStatus = 'PENDING' | 'RESOLVED' | 'FAILED';
export type EnrichmentSource = 'PRICING' | 'INVENTORY' | 'MEDIA';
export type EnrichmentRetryStatus = 'PENDING' | 'RETRYING' | 'RESOLVED' | 'FAILED';

export interface EndpointMapping {
  mapping_id: number;
  standard_type: MappingStandardType;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: MappingProtocol;
  payload_format: MappingPayloadFormat;
  is_product_endpoint: boolean;
  structure_json: Record<string, unknown>;
  structure_xml: string | null;
  request_schema: Record<string, unknown>;
  response_schema: Record<string, unknown>;
  transform_schema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VendorEndpointMapping {
  vendor_endpoint_mapping_id: number;
  vendor_id: number;
  mapping_id: number;
  is_enabled: boolean;
  runtime_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EtlSyncRun {
  sync_run_id: number;
  vendor_id: number;
  mapping_id: number | null;
  sync_scope: SyncScope;
  status: SyncRunStatus;
  started_at: string;
  ended_at: string | null;
  records_read: number;
  records_written: number;
  error_message: string | null;
  details: Record<string, unknown>;
}

export interface VendorProductMap {
  vendor_product_map_id: number;
  vendor_id: number;
  mapping_id: number | null;
  vendor_product_id: string | null;
  bigcommerce_product_id: number | null;
  sku: string;
  product_name: string;
  last_synced_at: string;
  metadata: Record<string, unknown>;
}

export interface PendingRelatedProductLink {
  pending_related_product_link_id: number;
  vendor_id: number;
  source_vendor_product_id: string;
  target_vendor_product_id: string;
  source_bigcommerce_product_id: number | null;
  target_bigcommerce_product_id: number | null;
  status: PendingRelatedLinkStatus;
  retry_count: number;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface ProductEnrichmentRetry {
  product_enrichment_retry_id: number;
  vendor_id: number;
  vendor_product_id: string;
  source: EnrichmentSource;
  status: EnrichmentRetryStatus;
  retry_count: number;
  last_error: string | null;
  metadata: Record<string, unknown>;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}
