import type {
  EnrichmentRetryStatus,
  EnrichmentSource,
  EndpointMapping,
  EtlSyncRun,
  IntegrationJob,
  IntegrationJobEvent,
  IntegrationJobKind,
  IntegrationJobStatus,
  OrderIntegrationState,
  OrderLifecycleStatus,
  OperatorTrace,
  OperatorTraceCategory,
  MappingPayloadFormat,
  MappingProtocol,
  MappingStandardType,
  PendingRelatedLinkStatus,
  PendingRelatedProductLink,
  ProductEnrichmentRetry,
  SyncRunStatus,
  SyncScope,
  VendorEndpointMapping,
  VendorEndpointUrl,
  VendorProductMap,
} from '../../types';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { seedPromoStandardsMappings } from './promostandardsSeed';

let promoStandardsSeedPromise: Promise<void> | null = null;

async function ensurePromoStandardsMappingsSeeded(): Promise<void> {
  if (!promoStandardsSeedPromise) {
    promoStandardsSeedPromise = seedPromoStandardsMappings()
      .then(() => undefined)
      .catch(error => {
        promoStandardsSeedPromise = null;
        throw error;
      });
  }

  await promoStandardsSeedPromise;
}

export interface EndpointMappingUpsertInput {
  standard_type: MappingStandardType;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol?: MappingProtocol;
  payload_format?: MappingPayloadFormat;
  is_product_endpoint?: boolean;
  structure_json?: Record<string, unknown>;
  structure_xml?: string | null;
  request_schema?: Record<string, unknown>;
  response_schema?: Record<string, unknown>;
  transform_schema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface VendorEndpointMappingInput {
  vendor_id: number;
  endpoint_mapping_id: number;
  is_enabled?: boolean;
  runtime_config?: Record<string, unknown>;
}

export interface VendorEndpointUrlInput {
  vendorId: number;
  endpointMappingId: number;
  endpointUrl: string;
}

export interface SyncRunCreateInput {
  vendor_id: number;
  endpoint_mapping_id?: number | null;
  sync_scope?: SyncScope;
  details?: Record<string, unknown>;
}

export interface IntegrationJobCreateInput {
  job_kind: IntegrationJobKind;
  vendor_id: number;
  endpoint_mapping_id?: number | null;
  order_integration_state_id?: number | null;
  sync_scope?: SyncScope;
  source_action: string;
  dedupe_key: string;
  correlation_id: string;
  request_payload?: Record<string, unknown>;
  status?: IntegrationJobStatus;
  queue_message_id?: string | null;
  attempt_count?: number;
  last_error?: string | null;
}

export interface IntegrationJobUpdateInput {
  integration_job_id: number;
  status?: IntegrationJobStatus;
  attempt_count?: number;
  queue_message_id?: string | null;
  last_error?: string | null;
  started_at?: Date | null;
  ended_at?: Date | null;
}

export interface IntegrationJobEventCreateInput {
  integration_job_id: number;
  event_name: string;
  level?: 'info' | 'warn' | 'error';
  payload?: Record<string, unknown>;
}

export interface OperatorTraceCreateInput {
  category: OperatorTraceCategory;
  correlation_id: string;
  vendor_id?: number | null;
  integration_job_id?: number | null;
  order_integration_state_id?: number | null;
  etl_sync_run_id?: number | null;
  method: string;
  target: string;
  action: string;
  status_code?: number | null;
  snapshot_bucket?: string | null;
  snapshot_key?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SyncRunCompleteInput {
  etl_sync_run_id: number;
  status: Exclude<SyncRunStatus, 'RUNNING' | 'PENDING'>;
  records_read?: number;
  records_written?: number;
  error_message?: string | null;
  details?: Record<string, unknown>;
}

export interface SyncRunProgressInput {
  etl_sync_run_id: number;
  records_read?: number;
  records_written?: number;
  details?: Record<string, unknown>;
}

export interface VendorProductMapUpsertInput {
  vendor_id: number;
  endpoint_mapping_id?: number | null;
  vendor_product_id?: string | null;
  bigcommerce_product_id?: number | null;
  sku: string;
  product_name: string;
  metadata?: Record<string, unknown>;
}

export interface PendingRelatedProductLinkUpsertInput {
  vendor_id: number;
  source_vendor_product_id: string;
  target_vendor_product_id: string;
  source_bigcommerce_product_id?: number | null;
  target_bigcommerce_product_id?: number | null;
  status?: PendingRelatedLinkStatus;
  retry_count?: number;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
  resolved_at?: Date | null;
}

export interface ProductEnrichmentRetryUpsertInput {
  vendor_id: number;
  vendor_product_id: string;
  source: EnrichmentSource;
  status?: EnrichmentRetryStatus;
  retry_count?: number;
  last_error?: string | null;
  metadata?: Record<string, unknown>;
  next_retry_at?: Date | null;
  resolved_at?: Date | null;
}

export interface OrderIntegrationStateCreateInput {
  vendor_id: number;
  external_order_id: string;
  order_source?: string;
  purchase_order_number: string;
  sales_order_number?: string | null;
  order_type?: string | null;
  lifecycle_status?: OrderLifecycleStatus;
  status_label?: string | null;
  status_code?: string | null;
  shipment_status?: string | null;
  invoice_status?: string | null;
  remittance_status?: string | null;
  submission_payload?: Record<string, unknown>;
  latest_vendor_payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  last_error?: string | null;
  submitted_at?: Date | null;
  last_status_polled_at?: Date | null;
  next_status_poll_at?: Date | null;
  last_shipment_polled_at?: Date | null;
  next_shipment_poll_at?: Date | null;
  last_invoice_polled_at?: Date | null;
  next_invoice_poll_at?: Date | null;
  last_remittance_submitted_at?: Date | null;
  completed_at?: Date | null;
}

export interface OrderIntegrationStateUpdateInput {
  order_integration_state_id: number;
  sales_order_number?: string | null;
  lifecycle_status?: OrderLifecycleStatus;
  status_label?: string | null;
  status_code?: string | null;
  shipment_status?: string | null;
  invoice_status?: string | null;
  remittance_status?: string | null;
  latest_vendor_payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  last_error?: string | null;
  submitted_at?: Date | null;
  last_status_polled_at?: Date | null;
  next_status_poll_at?: Date | null;
  last_shipment_polled_at?: Date | null;
  next_shipment_poll_at?: Date | null;
  last_invoice_polled_at?: Date | null;
  next_invoice_poll_at?: Date | null;
  last_remittance_submitted_at?: Date | null;
  completed_at?: Date | null;
}

function serializeEndpointMapping(row: {
  endpoint_mapping_id: number;
  standard_type: MappingStandardType;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: MappingProtocol;
  payload_format: MappingPayloadFormat;
  is_product_endpoint: boolean;
  structure_json: unknown;
  structure_xml: string | null;
  request_schema: unknown;
  response_schema: unknown;
  transform_schema: unknown;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}): EndpointMapping {
  return {
    ...row,
    structure_json: (row.structure_json ?? {}) as Record<string, unknown>,
    request_schema: (row.request_schema ?? {}) as Record<string, unknown>,
    response_schema: (row.response_schema ?? {}) as Record<string, unknown>,
    transform_schema: (row.transform_schema ?? {}) as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function serializeVendorEndpointMapping(row: {
  vendor_endpoint_mapping_id: number;
  vendor_id: number;
  endpoint_mapping_id: number;
  is_enabled: boolean;
  runtime_config: unknown;
  endpointUrl?: string | null;
  created_at: Date;
  updated_at: Date;
}): VendorEndpointMapping {
  return {
    ...row,
    runtime_config: (row.runtime_config ?? {}) as Record<string, unknown>,
    endpointUrl: row.endpointUrl ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function serializeVendorEndpointUrl(row: {
  vendor_endpoint_url_id: number;
  vendor_id: number;
  endpoint_mapping_id: number;
  endpoint_url: string;
  created_at: Date;
  updated_at: Date;
}): VendorEndpointUrl {
  return {
    vendor_endpoint_url_id: row.vendor_endpoint_url_id,
    vendor_id: row.vendor_id,
    endpoint_mapping_id: row.endpoint_mapping_id,
    endpoint_url: row.endpoint_url,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function serializeSyncRun(row: {
  etl_sync_run_id: bigint;
  vendor_id: number;
  endpoint_mapping_id: number | null;
  sync_scope: SyncScope;
  status: SyncRunStatus;
  started_at: Date;
  ended_at: Date | null;
  records_read: number;
  records_written: number;
  error_message: string | null;
  details: unknown;
}): EtlSyncRun {
  return {
    etl_sync_run_id: Number(row.etl_sync_run_id),
    vendor_id: row.vendor_id,
    endpoint_mapping_id: row.endpoint_mapping_id,
    sync_scope: row.sync_scope,
    status: row.status,
    started_at: row.started_at.toISOString(),
    ended_at: row.ended_at ? row.ended_at.toISOString() : null,
    records_read: row.records_read,
    records_written: row.records_written,
    error_message: row.error_message,
    details: (row.details ?? {}) as Record<string, unknown>,
  };
}

function serializeIntegrationJob(row: {
  integration_job_id: bigint;
  job_kind: IntegrationJobKind;
  vendor_id: number;
  endpoint_mapping_id: number | null;
  order_integration_state_id: bigint | null;
  sync_scope: SyncScope;
  source_action: string;
  dedupe_key: string;
  correlation_id: string;
  request_payload: unknown;
  status: IntegrationJobStatus;
  attempt_count: number;
  queue_message_id: string | null;
  last_error: string | null;
  submitted_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
}): IntegrationJob {
  return {
    integration_job_id: Number(row.integration_job_id),
    job_kind: row.job_kind,
    vendor_id: row.vendor_id,
    endpoint_mapping_id: row.endpoint_mapping_id,
    order_integration_state_id: row.order_integration_state_id ? Number(row.order_integration_state_id) : null,
    sync_scope: row.sync_scope,
    source_action: row.source_action,
    dedupe_key: row.dedupe_key,
    correlation_id: row.correlation_id,
    request_payload: (row.request_payload ?? {}) as Record<string, unknown>,
    status: row.status,
    attempt_count: row.attempt_count,
    queue_message_id: row.queue_message_id,
    last_error: row.last_error,
    submitted_at: row.submitted_at.toISOString(),
    started_at: row.started_at ? row.started_at.toISOString() : null,
    ended_at: row.ended_at ? row.ended_at.toISOString() : null,
  };
}

function serializeIntegrationJobEvent(row: {
  integration_job_event_id: bigint;
  integration_job_id: bigint;
  event_name: string;
  level: string;
  payload: unknown;
  created_at: Date;
}): IntegrationJobEvent {
  return {
    integration_job_event_id: Number(row.integration_job_event_id),
    integration_job_id: Number(row.integration_job_id),
    event_name: row.event_name,
    level: row.level as IntegrationJobEvent['level'],
    payload: (row.payload ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
  };
}

function serializeOperatorTrace(row: {
  operator_trace_id: bigint;
  category: OperatorTraceCategory;
  correlation_id: string;
  vendor_id: number | null;
  integration_job_id: bigint | null;
  order_integration_state_id: bigint | null;
  etl_sync_run_id: bigint | null;
  method: string;
  target: string;
  action: string;
  status_code: number | null;
  snapshot_bucket: string | null;
  snapshot_key: string | null;
  metadata: unknown;
  created_at: Date;
}): OperatorTrace {
  return {
    operator_trace_id: Number(row.operator_trace_id),
    category: row.category,
    correlation_id: row.correlation_id,
    vendor_id: row.vendor_id,
    integration_job_id: row.integration_job_id ? Number(row.integration_job_id) : null,
    order_integration_state_id: row.order_integration_state_id ? Number(row.order_integration_state_id) : null,
    etl_sync_run_id: row.etl_sync_run_id ? Number(row.etl_sync_run_id) : null,
    method: row.method,
    target: row.target,
    action: row.action,
    status_code: row.status_code,
    snapshot_bucket: row.snapshot_bucket,
    snapshot_key: row.snapshot_key,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
  };
}

function serializeVendorProductMap(row: {
  vendor_product_map_id: bigint;
  vendor_id: number;
  endpoint_mapping_id: number | null;
  vendor_product_id: string | null;
  bigcommerce_product_id: bigint | null;
  sku: string;
  product_name: string;
  last_synced_at: Date;
  metadata: unknown;
}): VendorProductMap {
  return {
    vendor_product_map_id: Number(row.vendor_product_map_id),
    vendor_id: row.vendor_id,
    endpoint_mapping_id: row.endpoint_mapping_id,
    vendor_product_id: row.vendor_product_id,
    bigcommerce_product_id: row.bigcommerce_product_id ? Number(row.bigcommerce_product_id) : null,
    sku: row.sku,
    product_name: row.product_name,
    last_synced_at: row.last_synced_at.toISOString(),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

function serializePendingRelatedProductLink(row: {
  pending_related_product_link_id: bigint;
  vendor_id: number;
  source_vendor_product_id: string;
  target_vendor_product_id: string;
  source_bigcommerce_product_id: bigint | null;
  target_bigcommerce_product_id: bigint | null;
  status: PendingRelatedLinkStatus;
  retry_count: number;
  last_error: string | null;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}): PendingRelatedProductLink {
  return {
    pending_related_product_link_id: Number(row.pending_related_product_link_id),
    vendor_id: row.vendor_id,
    source_vendor_product_id: row.source_vendor_product_id,
    target_vendor_product_id: row.target_vendor_product_id,
    source_bigcommerce_product_id: row.source_bigcommerce_product_id
      ? Number(row.source_bigcommerce_product_id)
      : null,
    target_bigcommerce_product_id: row.target_bigcommerce_product_id
      ? Number(row.target_bigcommerce_product_id)
      : null,
    status: row.status,
    retry_count: row.retry_count,
    last_error: row.last_error,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

function serializeProductEnrichmentRetry(row: {
  product_enrichment_retry_id: bigint;
  vendor_id: number;
  vendor_product_id: string;
  source: EnrichmentSource;
  status: EnrichmentRetryStatus;
  retry_count: number;
  last_error: string | null;
  metadata: unknown;
  next_retry_at: Date | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}): ProductEnrichmentRetry {
  return {
    product_enrichment_retry_id: Number(row.product_enrichment_retry_id),
    vendor_id: row.vendor_id,
    vendor_product_id: row.vendor_product_id,
    source: row.source,
    status: row.status,
    retry_count: row.retry_count,
    last_error: row.last_error,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    next_retry_at: row.next_retry_at ? row.next_retry_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

function serializeOrderIntegrationState(row: {
  order_integration_state_id: bigint;
  vendor_id: number;
  external_order_id: string;
  order_source: string;
  purchase_order_number: string;
  sales_order_number: string | null;
  order_type: string | null;
  lifecycle_status: OrderLifecycleStatus;
  status_label: string | null;
  status_code: string | null;
  shipment_status: string | null;
  invoice_status: string | null;
  remittance_status: string | null;
  submission_payload: unknown;
  latest_vendor_payload: unknown;
  metadata: unknown;
  last_error: string | null;
  submitted_at: Date | null;
  last_status_polled_at: Date | null;
  next_status_poll_at: Date | null;
  last_shipment_polled_at: Date | null;
  next_shipment_poll_at: Date | null;
  last_invoice_polled_at: Date | null;
  next_invoice_poll_at: Date | null;
  last_remittance_submitted_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}): OrderIntegrationState {
  return {
    order_integration_state_id: Number(row.order_integration_state_id),
    vendor_id: row.vendor_id,
    external_order_id: row.external_order_id,
    order_source: row.order_source,
    purchase_order_number: row.purchase_order_number,
    sales_order_number: row.sales_order_number,
    order_type: row.order_type,
    lifecycle_status: row.lifecycle_status,
    status_label: row.status_label,
    status_code: row.status_code,
    shipment_status: row.shipment_status,
    invoice_status: row.invoice_status,
    remittance_status: row.remittance_status,
    submission_payload: (row.submission_payload ?? {}) as Record<string, unknown>,
    latest_vendor_payload: (row.latest_vendor_payload ?? {}) as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    last_error: row.last_error,
    submitted_at: row.submitted_at ? row.submitted_at.toISOString() : null,
    last_status_polled_at: row.last_status_polled_at ? row.last_status_polled_at.toISOString() : null,
    next_status_poll_at: row.next_status_poll_at ? row.next_status_poll_at.toISOString() : null,
    last_shipment_polled_at: row.last_shipment_polled_at ? row.last_shipment_polled_at.toISOString() : null,
    next_shipment_poll_at: row.next_shipment_poll_at ? row.next_shipment_poll_at.toISOString() : null,
    last_invoice_polled_at: row.last_invoice_polled_at ? row.last_invoice_polled_at.toISOString() : null,
    next_invoice_poll_at: row.next_invoice_poll_at ? row.next_invoice_poll_at.toISOString() : null,
    last_remittance_submitted_at: row.last_remittance_submitted_at
      ? row.last_remittance_submitted_at.toISOString()
      : null,
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function listEndpointMappings(filters?: {
  standard_type?: MappingStandardType;
  protocol?: MappingProtocol;
  endpoint_name?: string;
  endpoint_version?: string;
  is_product_endpoint?: boolean;
}): Promise<EndpointMapping[]> {
  if (filters?.standard_type !== 'CUSTOM') {
    await ensurePromoStandardsMappingsSeeded();
  }

  const rows = await prisma.endpointMapping.findMany({
    where: {
      standard_type: filters?.standard_type,
      protocol: filters?.protocol,
      endpoint_name: filters?.endpoint_name,
      endpoint_version: filters?.endpoint_version,
      is_product_endpoint: typeof filters?.is_product_endpoint === 'boolean' ? filters.is_product_endpoint : undefined,
    },
    orderBy: [
      { endpoint_name: 'asc' },
      { endpoint_version: 'asc' },
      { operation_name: 'asc' },
    ],
  });

  return rows.map(serializeEndpointMapping);
}

export async function getEndpointMappingById(mappingId: number): Promise<EndpointMapping | null> {
  const row = await prisma.endpointMapping.findUnique({
    where: { endpoint_mapping_id: mappingId },
  });
  return row ? serializeEndpointMapping(row) : null;
}

export async function upsertEndpointMapping(
  input: EndpointMappingUpsertInput,
): Promise<EndpointMapping> {
  const row = await prisma.endpointMapping.upsert({
    where: {
      standard_type_endpoint_name_endpoint_version_operation_name: {
        standard_type: input.standard_type,
        endpoint_name: input.endpoint_name,
        endpoint_version: input.endpoint_version,
        operation_name: input.operation_name,
      },
    },
    create: {
      standard_type: input.standard_type,
      endpoint_name: input.endpoint_name,
      endpoint_version: input.endpoint_version,
      operation_name: input.operation_name,
      protocol: input.protocol ?? 'SOAP',
      payload_format: input.payload_format ?? 'JSON',
      is_product_endpoint: input.is_product_endpoint ?? false,
      structure_json: toJson(input.structure_json),
      structure_xml: input.structure_xml ?? null,
      request_schema: toJson(input.request_schema),
      response_schema: toJson(input.response_schema),
      transform_schema: toJson(input.transform_schema),
      metadata: toJson(input.metadata),
    },
    update: {
      protocol: input.protocol ?? 'SOAP',
      payload_format: input.payload_format ?? 'JSON',
      is_product_endpoint: input.is_product_endpoint ?? false,
      structure_json: toJson(input.structure_json),
      structure_xml: input.structure_xml ?? null,
      request_schema: toJson(input.request_schema),
      response_schema: toJson(input.response_schema),
      transform_schema: toJson(input.transform_schema),
      metadata: toJson(input.metadata),
      updated_at: new Date(),
    },
  });

  return serializeEndpointMapping(row);
}

export async function upsertEndpointMappings(
  inputs: EndpointMappingUpsertInput[],
): Promise<EndpointMapping[]> {
  const output: EndpointMapping[] = [];
  for (const input of inputs) {
    output.push(await upsertEndpointMapping(input));
  }
  return output;
}

export async function findMappingsByEndpointVersions(
  selections: Array<{ endpoint_name: string; endpoint_version: string }>,
): Promise<EndpointMapping[]> {
  if (selections.length === 0) return [];
  await ensurePromoStandardsMappingsSeeded();
  const rows = await prisma.endpointMapping.findMany({
    where: {
      standard_type: 'PROMOSTANDARDS',
      OR: selections.map(selection => ({
        endpoint_name: selection.endpoint_name,
        endpoint_version: selection.endpoint_version,
      })),
    },
    orderBy: [
      { endpoint_name: 'asc' },
      { endpoint_version: 'asc' },
      { operation_name: 'asc' },
    ],
  });
  return rows.map(serializeEndpointMapping);
}

export async function findMappingsByEndpointOperations(
  selections: Array<{ endpoint_name: string; endpoint_version: string; operation_name: string }>,
): Promise<EndpointMapping[]> {
  if (selections.length === 0) return [];
  await ensurePromoStandardsMappingsSeeded();
  const rows = await prisma.endpointMapping.findMany({
    where: {
      standard_type: 'PROMOSTANDARDS',
      OR: selections.map(selection => ({
        endpoint_name: selection.endpoint_name,
        endpoint_version: selection.endpoint_version,
        operation_name: selection.operation_name,
      })),
    },
    orderBy: [
      { endpoint_name: 'asc' },
      { endpoint_version: 'asc' },
      { operation_name: 'asc' },
    ],
  });
  return rows.map(serializeEndpointMapping);
}

export async function listEndpointMappingsByIds(mappingIds: number[]): Promise<EndpointMapping[]> {
  if (mappingIds.length === 0) return [];
  const rows = await prisma.endpointMapping.findMany({
    where: {
      endpoint_mapping_id: {
        in: mappingIds,
      },
    },
    orderBy: [
      { endpoint_name: 'asc' },
      { endpoint_version: 'asc' },
      { operation_name: 'asc' },
    ],
  });
  return rows.map(serializeEndpointMapping);
}

export async function upsertVendorEndpointMapping(
  input: VendorEndpointMappingInput,
): Promise<VendorEndpointMapping> {
  const row = await prisma.vendorEndpointMapping.upsert({
    where: {
      vendor_id_endpoint_mapping_id: {
        vendor_id: input.vendor_id,
        endpoint_mapping_id: input.endpoint_mapping_id,
      },
    },
    create: {
      vendor_id: input.vendor_id,
      endpoint_mapping_id: input.endpoint_mapping_id,
      is_enabled: input.is_enabled ?? true,
      runtime_config: toJson(input.runtime_config),
    },
    update: {
      is_enabled: input.is_enabled ?? true,
      runtime_config: toJson(input.runtime_config),
      updated_at: new Date(),
    },
  });

  return serializeVendorEndpointMapping(row);
}

export async function listVendorEndpointMappings(vendorId: number): Promise<VendorEndpointMapping[]> {
  const rows = await prisma.vendorEndpointMapping.findMany({
    where: { vendor_id: vendorId },
    orderBy: { endpoint_mapping_id: 'asc' },
  });
  return rows.map(serializeVendorEndpointMapping);
}

export async function listVendorEndpointUrls(vendorId: number): Promise<VendorEndpointUrl[]> {
  const rows = await prisma.vendorEndpointUrl.findMany({
    where: { vendor_id: vendorId },
    orderBy: { endpoint_mapping_id: 'asc' },
  });
  return rows.map(serializeVendorEndpointUrl);
}

export async function listEnabledVendorEndpointMappings(
  vendorId: number,
): Promise<Array<VendorEndpointMapping & { mapping: EndpointMapping }>> {
  const [rows, endpointUrls] = await Promise.all([
    prisma.vendorEndpointMapping.findMany({
      where: {
        vendor_id: vendorId,
        is_enabled: true,
      },
      include: {
        endpoint_mapping: true,
      },
      orderBy: { endpoint_mapping_id: 'asc' },
    }),
    prisma.vendorEndpointUrl.findMany({
      where: { vendor_id: vendorId },
      orderBy: { endpoint_mapping_id: 'asc' },
    }),
  ]);
  const endpointUrlByMappingId = new Map(
    endpointUrls.map(row => [row.endpoint_mapping_id, row.endpoint_url]),
  );

  return rows.map(row => ({
    ...serializeVendorEndpointMapping({
      ...row,
      endpointUrl: endpointUrlByMappingId.get(row.endpoint_mapping_id) ?? null,
    }),
    mapping: serializeEndpointMapping(row.endpoint_mapping),
  }));
}

export async function replaceVendorEndpointMappings(
  vendorId: number,
  mappingIds: number[],
): Promise<VendorEndpointMapping[]> {
  if (mappingIds.length === 0) {
    await prisma.vendorEndpointMapping.deleteMany({
      where: { vendor_id: vendorId },
    });
    return [];
  }

  await prisma.$transaction([
    prisma.vendorEndpointMapping.deleteMany({
      where: {
        vendor_id: vendorId,
        endpoint_mapping_id: {
          notIn: mappingIds,
        },
      },
    }),
    ...mappingIds.map(mappingId =>
      prisma.vendorEndpointMapping.upsert({
        where: {
          vendor_id_endpoint_mapping_id: {
            vendor_id: vendorId,
            endpoint_mapping_id: mappingId,
          },
        },
        create: {
          vendor_id: vendorId,
          endpoint_mapping_id: mappingId,
          is_enabled: true,
          runtime_config: toJson({}),
        },
        update: {
          is_enabled: true,
          updated_at: new Date(),
        },
      }),
    ),
  ]);

  const rows = await prisma.vendorEndpointMapping.findMany({
    where: { vendor_id: vendorId },
    orderBy: { endpoint_mapping_id: 'asc' },
  });
  return rows.map(serializeVendorEndpointMapping);
}

export async function replaceVendorEndpointUrls(
  vendorId: number,
  endpointUrls: VendorEndpointUrlInput[],
): Promise<VendorEndpointUrl[]> {
  if (endpointUrls.length === 0) {
    await prisma.vendorEndpointUrl.deleteMany({
      where: { vendor_id: vendorId },
    });
    return [];
  }

  const uniqueUrls = endpointUrls.filter(
    (item, index, values) =>
      values.findIndex(value => value.endpointMappingId === item.endpointMappingId) === index,
  );

  await prisma.$transaction([
    prisma.vendorEndpointUrl.deleteMany({
      where: {
        vendor_id: vendorId,
        endpoint_mapping_id: {
          notIn: uniqueUrls.map(item => item.endpointMappingId),
        },
      },
    }),
    ...uniqueUrls.map(item =>
      prisma.vendorEndpointUrl.upsert({
        where: {
          vendor_id_endpoint_mapping_id: {
            vendor_id: vendorId,
            endpoint_mapping_id: item.endpointMappingId,
          },
        },
        create: {
          vendor_id: vendorId,
          endpoint_mapping_id: item.endpointMappingId,
          endpoint_url: item.endpointUrl,
        },
        update: {
          endpoint_url: item.endpointUrl,
          updated_at: new Date(),
        },
      }),
    ),
  ]);

  const rows = await prisma.vendorEndpointUrl.findMany({
    where: { vendor_id: vendorId },
    orderBy: { endpoint_mapping_id: 'asc' },
  });
  return rows.map(serializeVendorEndpointUrl);
}

export async function createSyncRun(input: SyncRunCreateInput): Promise<EtlSyncRun> {
  const row = await prisma.etlSyncRun.create({
    data: {
      vendor_id: input.vendor_id,
      endpoint_mapping_id: input.endpoint_mapping_id ?? null,
      sync_scope: input.sync_scope ?? 'MAPPING',
      status: 'PENDING',
      details: toJson(input.details),
    },
  });
  return serializeSyncRun(row);
}

export async function createIntegrationJob(input: IntegrationJobCreateInput): Promise<IntegrationJob> {
  const row = await prisma.integrationJob.create({
    data: {
      job_kind: input.job_kind,
      vendor_id: input.vendor_id,
      endpoint_mapping_id: input.endpoint_mapping_id ?? null,
      order_integration_state_id: input.order_integration_state_id
        ? BigInt(input.order_integration_state_id)
        : null,
      sync_scope: input.sync_scope ?? 'MAPPING',
      source_action: input.source_action,
      dedupe_key: input.dedupe_key,
      correlation_id: input.correlation_id,
      request_payload: toJson(input.request_payload),
      status: input.status ?? 'PENDING',
      attempt_count: input.attempt_count ?? 0,
      queue_message_id: input.queue_message_id ?? null,
      last_error: input.last_error ?? null,
    },
  });
  return serializeIntegrationJob(row);
}

export async function getIntegrationJobById(integrationJobId: number): Promise<IntegrationJob | null> {
  const row = await prisma.integrationJob.findUnique({
    where: { integration_job_id: BigInt(integrationJobId) },
  });
  return row ? serializeIntegrationJob(row) : null;
}

export async function getSyncRunById(syncRunId: number): Promise<EtlSyncRun | null> {
  const row = await prisma.etlSyncRun.findUnique({
    where: { etl_sync_run_id: BigInt(syncRunId) },
  });
  return row ? serializeSyncRun(row) : null;
}

export async function findActiveIntegrationJobByDedupeKey(dedupeKey: string): Promise<IntegrationJob | null> {
  const row = await prisma.integrationJob.findFirst({
    where: {
      dedupe_key: dedupeKey,
      status: {
        in: ['PENDING', 'ENQUEUED', 'RUNNING', 'CANCEL_REQUESTED'],
      },
    },
    orderBy: {
      submitted_at: 'desc',
    },
  });
  return row ? serializeIntegrationJob(row) : null;
}

export async function findLatestActiveCatalogSyncJobForVendor(vendorId: number): Promise<IntegrationJob | null> {
  const row = await prisma.integrationJob.findFirst({
    where: {
      vendor_id: vendorId,
      job_kind: 'CATALOG_SYNC',
      status: {
        in: ['PENDING', 'ENQUEUED', 'RUNNING', 'CANCEL_REQUESTED'],
      },
    },
    orderBy: {
      submitted_at: 'desc',
    },
  });
  return row ? serializeIntegrationJob(row) : null;
}

export async function updateIntegrationJob(input: IntegrationJobUpdateInput): Promise<IntegrationJob | null> {
  const row = await prisma.integrationJob.update({
    where: { integration_job_id: BigInt(input.integration_job_id) },
    data: {
      status: input.status,
      attempt_count: input.attempt_count,
      queue_message_id: input.queue_message_id,
      last_error: input.last_error,
      started_at: input.started_at,
      ended_at: input.ended_at,
    },
  }).catch(() => null);

  return row ? serializeIntegrationJob(row) : null;
}

export async function markIntegrationJobEnqueued(
  integrationJobId: number,
  queueMessageId?: string | null,
): Promise<IntegrationJob | null> {
  return updateIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'ENQUEUED',
    queue_message_id: queueMessageId ?? null,
  });
}

export async function markIntegrationJobRunning(
  integrationJobId: number,
  nextAttemptCount: number,
): Promise<IntegrationJob | null> {
  return updateIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'RUNNING',
    attempt_count: nextAttemptCount,
    started_at: new Date(),
    ended_at: null,
    last_error: null,
  });
}

export async function finalizeIntegrationJob(input: {
  integration_job_id: number;
  status: Extract<IntegrationJobStatus, 'SUCCEEDED' | 'FAILED' | 'DEAD_LETTERED' | 'CANCELLED'>;
  last_error?: string | null;
}): Promise<IntegrationJob | null> {
  return updateIntegrationJob({
    integration_job_id: input.integration_job_id,
    status: input.status,
    last_error: input.last_error ?? null,
    ended_at: new Date(),
  });
}

export async function requestIntegrationJobCancellation(
  integrationJobId: number,
): Promise<IntegrationJob | null> {
  const job = await getIntegrationJobById(integrationJobId);
  if (!job) {
    return null;
  }

  if (['SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED'].includes(job.status)) {
    return job;
  }

  if (job.status === 'PENDING' || job.status === 'ENQUEUED') {
    return finalizeIntegrationJob({
      integration_job_id: integrationJobId,
      status: 'CANCELLED',
      last_error: 'Cancelled by operator.',
    });
  }

  return updateIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'CANCEL_REQUESTED',
    last_error: 'Cancellation requested by operator.',
  });
}

export async function createIntegrationJobEvent(
  input: IntegrationJobEventCreateInput,
): Promise<IntegrationJobEvent> {
  const row = await prisma.integrationJobEvent.create({
    data: {
      integration_job_id: BigInt(input.integration_job_id),
      event_name: input.event_name,
      level: input.level ?? 'info',
      payload: toJson(input.payload),
    },
  });
  return serializeIntegrationJobEvent(row);
}

export async function listIntegrationJobEvents(
  integrationJobId: number,
  limit = 50,
): Promise<IntegrationJobEvent[]> {
  const rows = await prisma.integrationJobEvent.findMany({
    where: {
      integration_job_id: BigInt(integrationJobId),
    },
    orderBy: {
      integration_job_event_id: 'desc',
    },
    take: limit,
  });
  return rows.map(serializeIntegrationJobEvent);
}

export async function createOperatorTrace(
  input: OperatorTraceCreateInput,
): Promise<OperatorTrace> {
  const row = await prisma.operatorTrace.create({
    data: {
      category: input.category,
      correlation_id: input.correlation_id,
      vendor_id: input.vendor_id ?? null,
      integration_job_id: input.integration_job_id ? BigInt(input.integration_job_id) : null,
      order_integration_state_id: input.order_integration_state_id
        ? BigInt(input.order_integration_state_id)
        : null,
      etl_sync_run_id: input.etl_sync_run_id ? BigInt(input.etl_sync_run_id) : null,
      method: input.method,
      target: input.target,
      action: input.action,
      status_code: input.status_code ?? null,
      snapshot_bucket: input.snapshot_bucket ?? null,
      snapshot_key: input.snapshot_key ?? null,
      metadata: toJson(input.metadata),
    },
  });

  return serializeOperatorTrace(row);
}

export async function getOperatorTraceById(operatorTraceId: number): Promise<OperatorTrace | null> {
  const row = await prisma.operatorTrace.findUnique({
    where: { operator_trace_id: BigInt(operatorTraceId) },
  });
  return row ? serializeOperatorTrace(row) : null;
}

export async function listOperatorTraces(filters?: {
  vendor_id?: number;
  integration_job_id?: number;
  order_integration_state_id?: number;
  etl_sync_run_id?: number;
  correlation_id?: string;
  categories?: OperatorTraceCategory[];
  limit?: number;
}): Promise<OperatorTrace[]> {
  const rows = await prisma.operatorTrace.findMany({
    where: {
      vendor_id: filters?.vendor_id,
      integration_job_id: filters?.integration_job_id ? BigInt(filters.integration_job_id) : undefined,
      order_integration_state_id: filters?.order_integration_state_id
        ? BigInt(filters.order_integration_state_id)
        : undefined,
      etl_sync_run_id: filters?.etl_sync_run_id ? BigInt(filters.etl_sync_run_id) : undefined,
      correlation_id: filters?.correlation_id,
      category: filters?.categories?.length ? { in: filters.categories } : undefined,
    },
    orderBy: {
      created_at: 'desc',
    },
    take: filters?.limit ?? 100,
  });

  return rows.map(serializeOperatorTrace);
}

export async function createOrderIntegrationState(
  input: OrderIntegrationStateCreateInput,
): Promise<OrderIntegrationState> {
  const row = await prisma.orderIntegrationState.create({
    data: {
      vendor_id: input.vendor_id,
      external_order_id: input.external_order_id,
      order_source: input.order_source ?? 'BIGCOMMERCE',
      purchase_order_number: input.purchase_order_number,
      sales_order_number: input.sales_order_number ?? null,
      order_type: input.order_type ?? null,
      lifecycle_status: input.lifecycle_status ?? 'PENDING_SUBMISSION',
      status_label: input.status_label ?? null,
      status_code: input.status_code ?? null,
      shipment_status: input.shipment_status ?? null,
      invoice_status: input.invoice_status ?? null,
      remittance_status: input.remittance_status ?? null,
      submission_payload: toJson(input.submission_payload),
      latest_vendor_payload: toJson(input.latest_vendor_payload),
      metadata: toJson(input.metadata),
      last_error: input.last_error ?? null,
      submitted_at: input.submitted_at ?? null,
      last_status_polled_at: input.last_status_polled_at ?? null,
      next_status_poll_at: input.next_status_poll_at ?? null,
      last_shipment_polled_at: input.last_shipment_polled_at ?? null,
      next_shipment_poll_at: input.next_shipment_poll_at ?? null,
      last_invoice_polled_at: input.last_invoice_polled_at ?? null,
      next_invoice_poll_at: input.next_invoice_poll_at ?? null,
      last_remittance_submitted_at: input.last_remittance_submitted_at ?? null,
      completed_at: input.completed_at ?? null,
    },
  });

  return serializeOrderIntegrationState(row);
}

export async function updateOrderIntegrationState(
  input: OrderIntegrationStateUpdateInput,
): Promise<OrderIntegrationState | null> {
  const row = await prisma.orderIntegrationState.update({
    where: { order_integration_state_id: BigInt(input.order_integration_state_id) },
    data: {
      sales_order_number: input.sales_order_number,
      lifecycle_status: input.lifecycle_status,
      status_label: input.status_label,
      status_code: input.status_code,
      shipment_status: input.shipment_status,
      invoice_status: input.invoice_status,
      remittance_status: input.remittance_status,
      latest_vendor_payload: input.latest_vendor_payload ? toJson(input.latest_vendor_payload) : undefined,
      metadata: input.metadata ? toJson(input.metadata) : undefined,
      last_error: input.last_error,
      submitted_at: input.submitted_at,
      last_status_polled_at: input.last_status_polled_at,
      next_status_poll_at: input.next_status_poll_at,
      last_shipment_polled_at: input.last_shipment_polled_at,
      next_shipment_poll_at: input.next_shipment_poll_at,
      last_invoice_polled_at: input.last_invoice_polled_at,
      next_invoice_poll_at: input.next_invoice_poll_at,
      last_remittance_submitted_at: input.last_remittance_submitted_at,
      completed_at: input.completed_at,
      updated_at: new Date(),
    },
  }).catch(() => null);

  return row ? serializeOrderIntegrationState(row) : null;
}

export async function getOrderIntegrationStateById(
  orderIntegrationStateId: number,
): Promise<OrderIntegrationState | null> {
  const row = await prisma.orderIntegrationState.findUnique({
    where: { order_integration_state_id: BigInt(orderIntegrationStateId) },
  });

  return row ? serializeOrderIntegrationState(row) : null;
}

export async function listOrderIntegrationStates(filters?: {
  vendor_id?: number;
  lifecycle_statuses?: OrderLifecycleStatus[];
  limit?: number;
}): Promise<OrderIntegrationState[]> {
  const rows = await prisma.orderIntegrationState.findMany({
    where: {
      vendor_id: filters?.vendor_id,
      lifecycle_status: filters?.lifecycle_statuses?.length
        ? { in: filters.lifecycle_statuses }
        : undefined,
    },
    orderBy: [
      { updated_at: 'desc' },
      { order_integration_state_id: 'desc' },
    ],
    take: filters?.limit ?? 100,
  });

  return rows.map(serializeOrderIntegrationState);
}

export async function findOrderIntegrationStateByExternalOrder(
  vendorId: number,
  externalOrderId: string,
): Promise<OrderIntegrationState | null> {
  const row = await prisma.orderIntegrationState.findFirst({
    where: {
      vendor_id: vendorId,
      external_order_id: externalOrderId,
    },
    orderBy: { updated_at: 'desc' },
  });

  return row ? serializeOrderIntegrationState(row) : null;
}

export async function listIntegrationJobsForOrderIntegrationState(
  orderIntegrationStateId: number,
  limit = 25,
): Promise<IntegrationJob[]> {
  const rows = await prisma.integrationJob.findMany({
    where: {
      order_integration_state_id: BigInt(orderIntegrationStateId),
    },
    orderBy: {
      submitted_at: 'desc',
    },
    take: limit,
  });

  return rows.map(serializeIntegrationJob);
}

export async function findDueOrderIntegrationStates(input: {
  pollField: 'next_status_poll_at' | 'next_shipment_poll_at' | 'next_invoice_poll_at';
  dueBefore?: Date;
  limit?: number;
}): Promise<OrderIntegrationState[]> {
  const dueBefore = input.dueBefore ?? new Date();
  const take = input.limit ?? 100;

  const baseWhere = {
    lifecycle_status: {
      notIn: ['FAILED', 'CANCELLED', 'COMPLETED'] as OrderLifecycleStatus[],
    },
  };

  let rows;
  switch (input.pollField) {
    case 'next_shipment_poll_at':
      rows = await prisma.orderIntegrationState.findMany({
        where: {
          ...baseWhere,
          next_shipment_poll_at: {
            lte: dueBefore,
          },
        },
        orderBy: {
          next_shipment_poll_at: 'asc',
        },
        take,
      });
      break;
    case 'next_invoice_poll_at':
      rows = await prisma.orderIntegrationState.findMany({
        where: {
          ...baseWhere,
          next_invoice_poll_at: {
            lte: dueBefore,
          },
        },
        orderBy: {
          next_invoice_poll_at: 'asc',
        },
        take,
      });
      break;
    case 'next_status_poll_at':
    default:
      rows = await prisma.orderIntegrationState.findMany({
        where: {
          ...baseWhere,
          next_status_poll_at: {
            lte: dueBefore,
          },
        },
        orderBy: {
          next_status_poll_at: 'asc',
        },
        take,
      });
      break;
  }

  return rows.map(serializeOrderIntegrationState);
}

export async function listSyncRunsPendingCatalogContinuation(limit = 100): Promise<EtlSyncRun[]> {
  const take = Math.max(1, Math.floor(limit));
  const rows = await prisma.$queryRaw<Array<{
    etl_sync_run_id: bigint;
    vendor_id: number;
    endpoint_mapping_id: number | null;
    sync_scope: SyncScope;
    status: SyncRunStatus;
    started_at: Date;
    ended_at: Date | null;
    records_read: number;
    records_written: number;
    error_message: string | null;
    details: unknown;
  }>>(Prisma.sql`
    SELECT
      "etl_sync_run_id",
      "vendor_id",
      "endpoint_mapping_id",
      "sync_scope",
      "status",
      "started_at",
      "ended_at",
      "records_read",
      "records_written",
      "error_message",
      "details"
    FROM "etl_sync_run"
    WHERE "status" = 'SUCCESS'
      AND jsonb_typeof("details") = 'object'
      AND jsonb_typeof("details"->'continuation') = 'object'
      AND COALESCE(("details"->'continuation'->>'enqueued')::boolean, false) = false
      AND ("details"->'continuation'->>'next_start_reference_index') IS NOT NULL
    ORDER BY "etl_sync_run_id" ASC
    LIMIT ${take}
  `);

  return rows.map(serializeSyncRun);
}

export async function markSyncRunRunning(syncRunId: number): Promise<EtlSyncRun | null> {
  const row = await prisma.etlSyncRun.update({
    where: { etl_sync_run_id: BigInt(syncRunId) },
    data: {
      status: 'RUNNING',
      started_at: new Date(),
    },
  }).catch(() => null);

  return row ? serializeSyncRun(row) : null;
}

export async function reconcileStaleCatalogSyncRunsForVendor(vendorId: number): Promise<number> {
  const activeJobStatuses: IntegrationJobStatus[] = ['PENDING', 'ENQUEUED', 'RUNNING', 'CANCEL_REQUESTED'];
  const activeRunStatuses: SyncRunStatus[] = ['PENDING', 'RUNNING'];

  const [activeCatalogJobCount, activeRuns] = await Promise.all([
    prisma.integrationJob.count({
      where: {
        vendor_id: vendorId,
        job_kind: 'CATALOG_SYNC',
        status: {
          in: activeJobStatuses,
        },
      },
    }),
    prisma.etlSyncRun.findMany({
      where: {
        vendor_id: vendorId,
        status: {
          in: activeRunStatuses,
        },
      },
      orderBy: {
        etl_sync_run_id: 'desc',
      },
      select: {
        etl_sync_run_id: true,
      },
    }),
  ]);

  const keepCount = Math.min(activeCatalogJobCount, activeRuns.length);
  const staleRunIds = activeRuns.slice(keepCount).map(run => run.etl_sync_run_id);
  if (staleRunIds.length === 0) {
    return 0;
  }

  const staleMessage =
    activeCatalogJobCount > 0
      ? 'Marked stale because a newer catalog sync run is active for this vendor.'
      : 'Marked stale because no active catalog sync job exists for this vendor.';

  const result = await prisma.etlSyncRun.updateMany({
    where: {
      etl_sync_run_id: {
        in: staleRunIds,
      },
      status: {
        in: activeRunStatuses,
      },
    },
    data: {
      status: 'FAILED',
      ended_at: new Date(),
      error_message: staleMessage,
    },
  });

  return result.count;
}

export async function updateSyncRunProgress(input: SyncRunProgressInput): Promise<EtlSyncRun | null> {
  const row = await prisma.etlSyncRun.update({
    where: { etl_sync_run_id: BigInt(input.etl_sync_run_id) },
    data: {
      records_read: input.records_read ?? undefined,
      records_written: input.records_written ?? undefined,
      details: input.details ? toJson(input.details) : undefined,
    },
  }).catch(() => null);

  return row ? serializeSyncRun(row) : null;
}

export async function completeSyncRun(input: SyncRunCompleteInput): Promise<EtlSyncRun | null> {
  const row = await prisma.etlSyncRun.update({
    where: { etl_sync_run_id: BigInt(input.etl_sync_run_id) },
    data: {
      status: input.status,
      ended_at: new Date(),
      records_read: input.records_read ?? undefined,
      records_written: input.records_written ?? undefined,
      error_message: input.error_message ?? null,
      details: input.details ? toJson(input.details) : undefined,
    },
  }).catch(() => null);

  return row ? serializeSyncRun(row) : null;
}

export async function listSyncRunsForVendor(vendorId: number, limit = 50): Promise<EtlSyncRun[]> {
  const rows = await prisma.etlSyncRun.findMany({
    where: { vendor_id: vendorId },
    orderBy: { etl_sync_run_id: 'desc' },
    take: limit,
  });
  return rows.map(serializeSyncRun);
}

export async function upsertVendorProductMap(
  input: VendorProductMapUpsertInput,
): Promise<VendorProductMap> {
  const row = await prisma.vendorProductMap.upsert({
    where: {
      vendor_id_sku: {
        vendor_id: input.vendor_id,
        sku: input.sku,
      },
    },
    create: {
      vendor_id: input.vendor_id,
      endpoint_mapping_id: input.endpoint_mapping_id ?? null,
      vendor_product_id: input.vendor_product_id ?? null,
      bigcommerce_product_id: input.bigcommerce_product_id ? BigInt(input.bigcommerce_product_id) : null,
      sku: input.sku,
      product_name: input.product_name,
      metadata: toJson(input.metadata),
    },
    update: {
      endpoint_mapping_id: input.endpoint_mapping_id ?? null,
      vendor_product_id: input.vendor_product_id ?? null,
      bigcommerce_product_id: input.bigcommerce_product_id ? BigInt(input.bigcommerce_product_id) : null,
      product_name: input.product_name,
      metadata: toJson(input.metadata),
      last_synced_at: new Date(),
    },
  });
  return serializeVendorProductMap(row);
}

export async function listVendorProductMap(vendorId: number): Promise<VendorProductMap[]> {
  const rows = await prisma.vendorProductMap.findMany({
    where: { vendor_id: vendorId },
    orderBy: { last_synced_at: 'desc' },
  });
  return rows.map(serializeVendorProductMap);
}

export async function findVendorProductMapsByBigCommerceProductIds(
  bigcommerceProductIds: number[],
): Promise<VendorProductMap[]> {
  if (bigcommerceProductIds.length === 0) {
    return [];
  }

  const rows = await prisma.vendorProductMap.findMany({
    where: {
      bigcommerce_product_id: {
        in: bigcommerceProductIds.map(value => BigInt(value)),
      },
    },
    orderBy: [
      { vendor_id: 'asc' },
      { last_synced_at: 'desc' },
    ],
  });

  return rows.map(serializeVendorProductMap);
}

export async function findVendorProductMapByVendorProductId(
  vendorId: number,
  vendorProductId: string,
): Promise<VendorProductMap | null> {
  const row = await prisma.vendorProductMap.findFirst({
    where: {
      vendor_id: vendorId,
      vendor_product_id: vendorProductId,
    },
    orderBy: { last_synced_at: 'desc' },
  });
  return row ? serializeVendorProductMap(row) : null;
}

export async function upsertPendingRelatedProductLink(
  input: PendingRelatedProductLinkUpsertInput,
): Promise<PendingRelatedProductLink> {
  const row = await prisma.pendingRelatedProductLink.upsert({
    where: {
      vendor_id_source_vendor_product_id_target_vendor_product_id: {
        vendor_id: input.vendor_id,
        source_vendor_product_id: input.source_vendor_product_id,
        target_vendor_product_id: input.target_vendor_product_id,
      },
    },
    create: {
      vendor_id: input.vendor_id,
      source_vendor_product_id: input.source_vendor_product_id,
      target_vendor_product_id: input.target_vendor_product_id,
      source_bigcommerce_product_id: input.source_bigcommerce_product_id
        ? BigInt(input.source_bigcommerce_product_id)
        : null,
      target_bigcommerce_product_id: input.target_bigcommerce_product_id
        ? BigInt(input.target_bigcommerce_product_id)
        : null,
      status: input.status ?? 'PENDING',
      retry_count: input.retry_count ?? 0,
      last_error: input.last_error ?? null,
      metadata: toJson(input.metadata),
      resolved_at: input.resolved_at ?? null,
    },
    update: {
      source_bigcommerce_product_id: input.source_bigcommerce_product_id
        ? BigInt(input.source_bigcommerce_product_id)
        : undefined,
      target_bigcommerce_product_id: input.target_bigcommerce_product_id
        ? BigInt(input.target_bigcommerce_product_id)
        : undefined,
      status: input.status ?? undefined,
      retry_count: input.retry_count ?? undefined,
      last_error: input.last_error ?? undefined,
      metadata: input.metadata ? toJson(input.metadata) : undefined,
      resolved_at: input.resolved_at ?? undefined,
      updated_at: new Date(),
    },
  });

  return serializePendingRelatedProductLink(row);
}

export async function listPendingRelatedProductLinks(
  vendorId: number,
  status: PendingRelatedLinkStatus | 'ALL' = 'PENDING',
  limit = 500,
): Promise<PendingRelatedProductLink[]> {
  const rows = await prisma.pendingRelatedProductLink.findMany({
    where: {
      vendor_id: vendorId,
      status: status === 'ALL' ? undefined : status,
    },
    orderBy: { pending_related_product_link_id: 'asc' },
    take: limit,
  });
  return rows.map(serializePendingRelatedProductLink);
}

export async function upsertProductEnrichmentRetry(
  input: ProductEnrichmentRetryUpsertInput,
): Promise<ProductEnrichmentRetry> {
  const row = await prisma.productEnrichmentRetry.upsert({
    where: {
      vendor_id_vendor_product_id_source: {
        vendor_id: input.vendor_id,
        vendor_product_id: input.vendor_product_id,
        source: input.source,
      },
    },
    create: {
      vendor_id: input.vendor_id,
      vendor_product_id: input.vendor_product_id,
      source: input.source,
      status: input.status ?? 'PENDING',
      retry_count: input.retry_count ?? 0,
      last_error: input.last_error ?? null,
      metadata: toJson(input.metadata),
      next_retry_at: input.next_retry_at ?? null,
      resolved_at: input.resolved_at ?? null,
    },
    update: {
      status: input.status ?? undefined,
      retry_count: input.retry_count ?? undefined,
      last_error: input.last_error ?? undefined,
      metadata: input.metadata ? toJson(input.metadata) : undefined,
      next_retry_at: input.next_retry_at ?? undefined,
      resolved_at: input.resolved_at ?? undefined,
      updated_at: new Date(),
    },
  });

  return serializeProductEnrichmentRetry(row);
}

export async function clearProductEnrichmentRetry(input: {
  vendor_id: number;
  vendor_product_id: string;
  source: EnrichmentSource;
}): Promise<void> {
  await prisma.productEnrichmentRetry.updateMany({
    where: {
      vendor_id: input.vendor_id,
      vendor_product_id: input.vendor_product_id,
      source: input.source,
    },
    data: {
      status: 'RESOLVED',
      resolved_at: new Date(),
      updated_at: new Date(),
      last_error: null,
    },
  });
}

export async function listProductEnrichmentRetries(
  vendorId: number,
  status: EnrichmentRetryStatus | 'ALL' = 'PENDING',
): Promise<ProductEnrichmentRetry[]> {
  const rows = await prisma.productEnrichmentRetry.findMany({
    where: {
      vendor_id: vendorId,
      status: status === 'ALL' ? undefined : status,
    },
    orderBy: { updated_at: 'desc' },
  });
  return rows.map(serializeProductEnrichmentRetry);
}
