export type MappingStandardType = 'PROMOSTANDARDS' | 'CUSTOM';

export type MappingProtocol = 'SOAP' | 'REST' | 'RPC' | 'XML' | 'JSON';

export type MappingPayloadFormat = 'JSON' | 'XML';

export type SyncScope = 'MAPPING' | 'ALL';

export type SyncRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
export type IntegrationJobKind =
  | 'CATALOG_SYNC'
  | 'ORDER_SUBMISSION'
  | 'ORDER_STATUS_POLL'
  | 'ORDER_SHIPMENT_POLL'
  | 'ORDER_INVOICE_POLL'
  | 'ORDER_REMITTANCE_SUBMISSION';
export type IntegrationJobStatus =
  | 'PENDING'
  | 'ENQUEUED'
  | 'RUNNING'
  | 'CANCEL_REQUESTED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DEAD_LETTERED'
  | 'CANCELLED';
export type OperatorTraceCategory = 'VENDOR_API' | 'BIGCOMMERCE_API' | 'INTERNAL_FAILURE';
export type PendingRelatedLinkStatus = 'PENDING' | 'RESOLVED' | 'FAILED';
export type EnrichmentSource = 'PRICING' | 'INVENTORY' | 'MEDIA';
export type EnrichmentRetryStatus = 'PENDING' | 'RETRYING' | 'RESOLVED' | 'FAILED';

export interface EndpointMapping {
  endpoint_mapping_id: number;
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
  endpoint_mapping_id: number;
  is_enabled: boolean;
  runtime_config: Record<string, unknown>;
  endpointUrl?: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorEndpointUrl {
  vendor_endpoint_url_id: number;
  vendor_id: number;
  endpoint_mapping_id: number;
  endpoint_url: string;
  created_at: string;
  updated_at: string;
}

export interface IntegrationJob {
  integration_job_id: number;
  job_kind: IntegrationJobKind;
  vendor_id: number;
  endpoint_mapping_id: number | null;
  order_integration_state_id: number | null;
  sync_scope: SyncScope;
  source_action: string;
  dedupe_key: string;
  correlation_id: string;
  request_payload: Record<string, unknown>;
  status: IntegrationJobStatus;
  attempt_count: number;
  queue_message_id: string | null;
  last_error: string | null;
  submitted_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface OperatorTrace {
  operator_trace_id: number;
  category: OperatorTraceCategory;
  correlation_id: string;
  vendor_id: number | null;
  integration_job_id: number | null;
  order_integration_state_id: number | null;
  etl_sync_run_id: number | null;
  method: string;
  target: string;
  action: string;
  status_code: number | null;
  snapshot_bucket: string | null;
  snapshot_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface IntegrationJobEvent {
  integration_job_event_id: number;
  integration_job_id: number;
  event_name: string;
  level: 'info' | 'warn' | 'error';
  payload: Record<string, unknown>;
  created_at: string;
}

export interface EtlSyncRun {
  etl_sync_run_id: number;
  vendor_id: number;
  endpoint_mapping_id: number | null;
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
  endpoint_mapping_id: number | null;
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
