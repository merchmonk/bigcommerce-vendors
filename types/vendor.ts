import type { MappingPayloadFormat, MappingProtocol, MappingStandardType } from './etl';

export type IntegrationFamily = MappingStandardType;

export interface EndpointMappingDraft {
  mapping_id?: number;
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

export interface VendorFormData {
  vendor_name: string;
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  integration_family: IntegrationFamily;
  api_protocol: MappingProtocol;
  endpoint_mappings: EndpointMappingDraft[];
  endpoint_mapping_ids?: number[];
  connection_tested?: boolean;
  connection_config?: Record<string, unknown>;
  auto_sync?: boolean;
}
