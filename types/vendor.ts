import type { MappingPayloadFormat, MappingProtocol, MappingStandardType } from './etl';

export type IntegrationFamily = MappingStandardType;
export type VendorType = 'SUPPLIER' | 'DECORATOR';
export type CustomApiServiceType =
  | 'REST_API'
  | 'SOAP_API'
  | 'JSON_FEED'
  | 'XML_FEED'
  | 'CSV_FEED';
export type VendorOperationalStatus = 'SYNCING' | 'SYNCED' | 'SYNC_FAILED' | 'DEACTIVATED';

export interface EndpointMappingDraft {
  endpoint_mapping_id?: number;
  enabled: boolean;
  endpoint_name?: string;
  endpoint_version?: string;
  operation_name?: string;
  protocol?: MappingProtocol;
  is_product_endpoint?: boolean;
  payload_format?: MappingPayloadFormat;
  structure_input?: string;
  transform_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  runtime_config?: Record<string, unknown>;
}

export interface PromostandardsEndpointCapability {
  endpointName: string;
  endpointVersion: string | null;
  endpointUrl: string;
  available: boolean;
  status_code: number | null;
  message: string;
  wsdl_available?: boolean | null;
  credentials_valid?: boolean | null;
  live_probe_message?: string | null;
  versionDetectionStatus?: 'detected_from_url' | 'detected_from_wsdl' | 'manual' | 'failed';
  requiresManualVersionSelection?: boolean;
  availableVersions?: string[];
}

export interface PromostandardsCapabilityMatrix {
  fingerprint: string;
  testedAt: string;
  availableEndpointCount: number;
  credentialsValid?: boolean | null;
  endpoints: PromostandardsEndpointCapability[];
}

export interface VendorConnectionTestResult {
  ok: boolean;
  message?: string;
  availableEndpointCount?: number;
  credentialsValid?: boolean | null;
  endpointMappingIds?: number[];
  fingerprint?: string;
  testedAt?: string;
  endpoints?: PromostandardsEndpointCapability[];
}

export interface VendorFormData {
  vendor_name: string;
  vendor_type: VendorType;
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  integration_family: IntegrationFamily;
  api_protocol?: MappingProtocol | null;
  custom_api_service_type?: CustomApiServiceType;
  custom_api_format_data?: string;
  endpoint_mappings: EndpointMappingDraft[];
  endpoint_mapping_ids?: number[];
  connection_tested?: boolean;
  hasCompanyDataEndpoint?: boolean;
  companyDataEndpointUrl?: string;
  promostandardsEndpoints?: PromostandardsEndpointCapability[];
  promostandardsCapabilities?: PromostandardsCapabilityMatrix | null;
  connection_config?: Record<string, unknown>;
  auto_sync?: boolean;
}

export interface VendorOperatorSummary {
  vendor_id: number;
  vendor_name: string;
  vendor_type: VendorType;
  integration_family: IntegrationFamily;
  api_protocol: MappingProtocol | null;
  is_active: boolean;
  datetime_added: string;
  datetime_modified: string;
  vendor_status: VendorOperationalStatus;
  api_type_label: string;
  health_percent: number | null;
  total_products_synced: number;
  total_products_active: number;
  last_synced_at: string | null;
  can_deactivate: boolean;
}

export interface DashboardRecentSyncItem {
  etl_sync_run_id: number;
  vendor_id: number;
  vendor_name: string;
  status: string;
  sync_scope: string;
  records_read: number;
  records_written: number;
  started_at: string;
  ended_at: string | null;
  error_message: string | null;
}

export interface DashboardRecentFailureItem {
  integration_job_id: number;
  vendor_id: number;
  vendor_name: string;
  status: string;
  submitted_at: string;
  last_error: string | null;
}

export interface OperatorDashboardSummary {
  totals: {
    vendors: number;
    syncing: number;
    synced: number;
    sync_failed: number;
    deactivated: number;
    active_products: number;
  };
  recent_syncs: DashboardRecentSyncItem[];
  recent_failures: DashboardRecentFailureItem[];
}
