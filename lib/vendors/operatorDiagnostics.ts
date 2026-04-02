import type {
  EtlSyncRun,
  IntegrationJob,
  IntegrationJobEvent,
  OperatorTrace,
} from '../../types';
import { getIntegrationJobStatus } from '../integrationJobs';
import {
  getOperatorTraceById,
  getSyncRunById,
  listOperatorTraces,
} from '../etl/repository';
import { readSnapshotArchivePayload } from '../snapshotArchive';

function makeError(message: string, statusCode: number): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

interface SyncRunDetailsSummary {
  endpointFailures: Array<Record<string, unknown>>;
  blockedProducts: Array<Record<string, unknown>>;
  mediaRetries: Array<Record<string, unknown>>;
  endpointFailureCount: number;
  blockedProductCount: number;
  mediaRetryCount: number;
  failedItemCount: number;
  endpointFailuresTruncated: boolean;
  blockedProductsTruncated: boolean;
  mediaRetriesTruncated: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value;
}

function isFailureEndpointResult(value: unknown): boolean {
  const record = asRecord(value);
  const status = typeof record.status === 'number' ? record.status : null;
  return status !== null && status >= 400;
}

function isBlockedProductStatus(value: unknown): boolean {
  const record = asRecord(value);
  return record.blocked === true;
}

export function summarizeSyncRunDetails(details: Record<string, unknown> | undefined): SyncRunDetailsSummary {
  const record = asRecord(details);
  const endpointResults = asArray(record.endpointResults).map(asRecord);
  const productStatuses = asArray(record.productStatuses).map(asRecord);
  const mediaRetries = asArray(record.mediaRetries).map(asRecord);
  const counts = asRecord(record.counts);
  const truncated = asRecord(record.truncated);

  const endpointFailures = endpointResults.filter(isFailureEndpointResult);
  const blockedProducts = productStatuses.filter(isBlockedProductStatus);
  const endpointFailureCount =
    typeof counts.endpointFailures === 'number' ? counts.endpointFailures : endpointFailures.length;
  const blockedProductCount =
    typeof counts.blockedProducts === 'number' ? counts.blockedProducts : blockedProducts.length;
  const mediaRetryCount =
    typeof counts.mediaRetries === 'number' ? counts.mediaRetries : mediaRetries.length;
  const failedItemCount =
    typeof counts.failedItems === 'number' ? counts.failedItems : blockedProductCount + mediaRetryCount;

  return {
    endpointFailures,
    blockedProducts,
    mediaRetries,
    endpointFailureCount,
    blockedProductCount,
    mediaRetryCount,
    failedItemCount,
    endpointFailuresTruncated: truncated.endpointResults === true,
    blockedProductsTruncated: truncated.productStatuses === true,
    mediaRetriesTruncated: truncated.mediaRetries === true,
  };
}

export async function getSyncRunDiagnostics(syncRunId: number, vendorId?: number): Promise<{
  syncRun: EtlSyncRun;
  summary: SyncRunDetailsSummary;
  traces: OperatorTrace[];
}> {
  const syncRun = await getSyncRunById(syncRunId);
  if (!syncRun) {
    throw makeError(`Sync run ${syncRunId} not found`, 404);
  }

  if (vendorId && syncRun.vendor_id !== vendorId) {
    throw makeError(`Sync run ${syncRunId} does not belong to vendor ${vendorId}`, 404);
  }

  const traces = await listOperatorTraces({
    etl_sync_run_id: syncRunId,
    limit: 200,
  });

  return {
    syncRun,
    summary: summarizeSyncRunDetails(syncRun.details),
    traces,
  };
}

export async function getIntegrationJobDiagnostics(integrationJobId: number): Promise<{
  job: IntegrationJob;
  events: IntegrationJobEvent[];
  traces: OperatorTrace[];
  readTraceSnapshot: (operatorTraceId: number) => Promise<Record<string, unknown> | null>;
}> {
  const payload = await getIntegrationJobStatus(integrationJobId);
  const traces = await listOperatorTraces({
    integration_job_id: integrationJobId,
    limit: 200,
  });

  return {
    ...payload,
    traces,
    readTraceSnapshot: async (operatorTraceId: number) => getOperatorTraceSnapshot(operatorTraceId),
  };
}

export async function getOperatorTraceSnapshot(
  operatorTraceId: number,
): Promise<Record<string, unknown> | null> {
  const trace = await getOperatorTraceById(operatorTraceId);
  if (!trace) {
    throw makeError(`Operator trace ${operatorTraceId} not found`, 404);
  }

  if (!trace.snapshot_bucket || !trace.snapshot_key) {
    return null;
  }

  return readSnapshotArchivePayload({
    bucket: trace.snapshot_bucket,
    key: trace.snapshot_key,
  });
}
