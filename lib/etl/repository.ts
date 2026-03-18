import type {
  EnrichmentRetryStatus,
  EnrichmentSource,
  EndpointMapping,
  EtlSyncRun,
  MappingPayloadFormat,
  MappingProtocol,
  MappingStandardType,
  PendingRelatedLinkStatus,
  PendingRelatedProductLink,
  ProductEnrichmentRetry,
  SyncRunStatus,
  SyncScope,
  VendorEndpointMapping,
  VendorProductMap,
} from '../../types';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';

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
  mapping_id: number;
  is_enabled?: boolean;
  runtime_config?: Record<string, unknown>;
}

export interface SyncRunCreateInput {
  vendor_id: number;
  mapping_id?: number | null;
  sync_scope?: SyncScope;
  details?: Record<string, unknown>;
}

export interface SyncRunCompleteInput {
  sync_run_id: number;
  status: Exclude<SyncRunStatus, 'RUNNING' | 'PENDING'>;
  records_read?: number;
  records_written?: number;
  error_message?: string | null;
  details?: Record<string, unknown>;
}

export interface VendorProductMapUpsertInput {
  vendor_id: number;
  mapping_id?: number | null;
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

function serializeEndpointMapping(row: {
  mapping_id: number;
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
  mapping_id: number;
  is_enabled: boolean;
  runtime_config: unknown;
  created_at: Date;
  updated_at: Date;
}): VendorEndpointMapping {
  return {
    ...row,
    runtime_config: (row.runtime_config ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function serializeSyncRun(row: {
  sync_run_id: bigint;
  vendor_id: number;
  mapping_id: number | null;
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
    sync_run_id: Number(row.sync_run_id),
    vendor_id: row.vendor_id,
    mapping_id: row.mapping_id,
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

function serializeVendorProductMap(row: {
  vendor_product_map_id: bigint;
  vendor_id: number;
  mapping_id: number | null;
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
    mapping_id: row.mapping_id,
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
    where: { mapping_id: mappingId },
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

export async function listEndpointMappingsByIds(mappingIds: number[]): Promise<EndpointMapping[]> {
  if (mappingIds.length === 0) return [];
  const rows = await prisma.endpointMapping.findMany({
    where: {
      mapping_id: {
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
      vendor_id_mapping_id: {
        vendor_id: input.vendor_id,
        mapping_id: input.mapping_id,
      },
    },
    create: {
      vendor_id: input.vendor_id,
      mapping_id: input.mapping_id,
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
    orderBy: { mapping_id: 'asc' },
  });
  return rows.map(serializeVendorEndpointMapping);
}

export async function listEnabledVendorEndpointMappings(
  vendorId: number,
): Promise<Array<VendorEndpointMapping & { mapping: EndpointMapping }>> {
  const rows = await prisma.vendorEndpointMapping.findMany({
    where: {
      vendor_id: vendorId,
      is_enabled: true,
    },
    include: {
      mapping: true,
    },
    orderBy: { mapping_id: 'asc' },
  });

  return rows.map(row => ({
    ...serializeVendorEndpointMapping(row),
    mapping: serializeEndpointMapping(row.mapping),
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
        mapping_id: {
          notIn: mappingIds,
        },
      },
    }),
    ...mappingIds.map(mappingId =>
      prisma.vendorEndpointMapping.upsert({
        where: {
          vendor_id_mapping_id: {
            vendor_id: vendorId,
            mapping_id: mappingId,
          },
        },
        create: {
          vendor_id: vendorId,
          mapping_id: mappingId,
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
    orderBy: { mapping_id: 'asc' },
  });
  return rows.map(serializeVendorEndpointMapping);
}

export async function createSyncRun(input: SyncRunCreateInput): Promise<EtlSyncRun> {
  const row = await prisma.etlSyncRun.create({
    data: {
      vendor_id: input.vendor_id,
      mapping_id: input.mapping_id ?? null,
      sync_scope: input.sync_scope ?? 'MAPPING',
      status: 'PENDING',
      details: toJson(input.details),
    },
  });
  return serializeSyncRun(row);
}

export async function markSyncRunRunning(syncRunId: number): Promise<EtlSyncRun | null> {
  const row = await prisma.etlSyncRun.update({
    where: { sync_run_id: BigInt(syncRunId) },
    data: {
      status: 'RUNNING',
      started_at: new Date(),
    },
  }).catch(() => null);

  return row ? serializeSyncRun(row) : null;
}

export async function completeSyncRun(input: SyncRunCompleteInput): Promise<EtlSyncRun | null> {
  const row = await prisma.etlSyncRun.update({
    where: { sync_run_id: BigInt(input.sync_run_id) },
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
    orderBy: { sync_run_id: 'desc' },
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
      mapping_id: input.mapping_id ?? null,
      vendor_product_id: input.vendor_product_id ?? null,
      bigcommerce_product_id: input.bigcommerce_product_id ? BigInt(input.bigcommerce_product_id) : null,
      sku: input.sku,
      product_name: input.product_name,
      metadata: toJson(input.metadata),
    },
    update: {
      mapping_id: input.mapping_id ?? null,
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
