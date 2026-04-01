import { randomUUID } from 'node:crypto';
import type { EtlSyncRun, IntegrationJob } from '../../types';
import { submitCatalogSyncJob, type CatalogSyncJobRequest } from '../integrationJobs';
import logger from '../logger';
import { getRequestContext } from '../requestContext';
import {
  findLatestActiveCatalogSyncJobForVendor,
  getSyncRunById,
  listSyncRunsPendingCatalogContinuation,
  updateSyncRunProgress,
} from './repository';

interface CatalogContinuationState {
  enqueued: boolean;
  nextStartReferenceIndex: number;
  totalReferences: number | null;
  maxReferencesPerRun: number;
  initialLastSuccessfulSyncAt: string | null;
  sourceAction: CatalogSyncJobRequest['sourceAction'];
  correlationId: string;
}

function getSchedulerBatchSize(): number {
  const configured = Number(process.env.CATALOG_CONTINUATION_SCHEDULER_BATCH_SIZE ?? '');
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return 100;
}

function getDefaultMaxReferencesPerRun(): number {
  const configured = Number(process.env.CATALOG_SYNC_MAX_PRODUCT_REFERENCES_PER_RUN ?? '');
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return 15;
}

function isCatalogSyncSourceAction(value: unknown): value is CatalogSyncJobRequest['sourceAction'] {
  return value === 'manual_sync' || value === 'manual_inventory_sync' || value === 'vendor_create_auto_sync';
}

function readCatalogContinuationState(syncRun: EtlSyncRun): CatalogContinuationState | null {
  const details = syncRun.details;
  if (!details || typeof details !== 'object') {
    return null;
  }

  const continuation = (details as { continuation?: unknown }).continuation;
  if (!continuation || typeof continuation !== 'object') {
    return null;
  }

  const record = continuation as Record<string, unknown>;
  const nextStartReferenceIndex = record.next_start_reference_index;
  if (typeof nextStartReferenceIndex !== 'number' || !Number.isFinite(nextStartReferenceIndex)) {
    return null;
  }

  const totalReferences =
    typeof record.total_references === 'number' && Number.isFinite(record.total_references)
      ? record.total_references
      : null;
  const maxReferencesPerRun =
    typeof record.max_references_per_run === 'number' && Number.isFinite(record.max_references_per_run) && record.max_references_per_run > 0
      ? Math.floor(record.max_references_per_run)
      : getDefaultMaxReferencesPerRun();
  const initialLastSuccessfulSyncAt =
    typeof record.initial_last_successful_sync_at === 'string' || record.initial_last_successful_sync_at === null
      ? (record.initial_last_successful_sync_at as string | null)
      : null;
  const sourceAction = isCatalogSyncSourceAction(record.source_action) ? record.source_action : 'manual_sync';
  const correlationId =
    typeof record.correlation_id === 'string' && record.correlation_id.trim().length > 0
      ? record.correlation_id
      : getRequestContext()?.correlationId ?? randomUUID();

  return {
    enqueued: record.enqueued === true,
    nextStartReferenceIndex: Math.floor(nextStartReferenceIndex),
    totalReferences,
    maxReferencesPerRun,
    initialLastSuccessfulSyncAt,
    sourceAction,
    correlationId,
  };
}

function readContinuationStartIndex(requestPayload: Record<string, unknown>): number | null {
  const continuation = requestPayload.continuation;
  if (!continuation || typeof continuation !== 'object') {
    return null;
  }

  const startReferenceIndex = (continuation as { start_reference_index?: unknown }).start_reference_index;
  if (typeof startReferenceIndex !== 'number' || !Number.isFinite(startReferenceIndex)) {
    return null;
  }

  return Math.floor(startReferenceIndex);
}

function isMatchingActiveContinuationJob(input: {
  activeJob: IntegrationJob | null;
  syncRun: EtlSyncRun;
  continuation: CatalogContinuationState;
}): boolean {
  const { activeJob, syncRun, continuation } = input;
  if (!activeJob || activeJob.job_kind !== 'CATALOG_SYNC') {
    return false;
  }

  if (activeJob.vendor_id !== syncRun.vendor_id) {
    return false;
  }

  if ((activeJob.endpoint_mapping_id ?? null) !== (syncRun.endpoint_mapping_id ?? null)) {
    return false;
  }

  if (activeJob.sync_scope !== syncRun.sync_scope) {
    return false;
  }

  if (activeJob.source_action !== continuation.sourceAction) {
    return false;
  }

  return readContinuationStartIndex(activeJob.request_payload) === continuation.nextStartReferenceIndex;
}

async function markSyncRunContinuationEnqueued(input: {
  syncRunId: number;
  integrationJobId: number | null;
  deduplicated: boolean;
}): Promise<void> {
  const syncRun = await getSyncRunById(input.syncRunId);
  if (!syncRun) {
    return;
  }

  const details = syncRun.details && typeof syncRun.details === 'object'
    ? { ...syncRun.details }
    : {};
  const continuation = details.continuation && typeof details.continuation === 'object'
    ? { ...(details.continuation as Record<string, unknown>) }
    : {};

  continuation.enqueued = true;
  continuation.integration_job_id = input.integrationJobId;
  continuation.enqueued_at = new Date().toISOString();
  continuation.deduplicated = input.deduplicated;
  details.continuation = continuation;

  await updateSyncRunProgress({
    etl_sync_run_id: input.syncRunId,
    details,
  });
}

export async function enqueuePendingCatalogContinuationJobs(input?: {
  limit?: number;
}): Promise<{
  queued: number;
  deduplicated: number;
  skipped: number;
  scanned: number;
}> {
  const pendingRuns = await listSyncRunsPendingCatalogContinuation(
    input?.limit ?? getSchedulerBatchSize(),
  );
  let queued = 0;
  let deduplicated = 0;
  let skipped = 0;

  for (const syncRun of pendingRuns) {
    const continuation = readCatalogContinuationState(syncRun);
    if (!continuation) {
      skipped += 1;
      logger.warn('catalog continuation scheduler skipped sync run with invalid continuation payload', {
        syncRunId: syncRun.etl_sync_run_id,
        vendorId: syncRun.vendor_id,
      });
      continue;
    }

    const activeJob = await findLatestActiveCatalogSyncJobForVendor(syncRun.vendor_id);
    if (isMatchingActiveContinuationJob({ activeJob, syncRun, continuation })) {
      deduplicated += 1;
      await markSyncRunContinuationEnqueued({
        syncRunId: syncRun.etl_sync_run_id,
        integrationJobId: activeJob?.integration_job_id ?? null,
        deduplicated: true,
      });
      continue;
    }

    if (activeJob) {
      skipped += 1;
      logger.info('catalog continuation scheduler deferred sync run because another catalog job is active', {
        syncRunId: syncRun.etl_sync_run_id,
        vendorId: syncRun.vendor_id,
        activeIntegrationJobId: activeJob.integration_job_id,
      });
      continue;
    }

    const submitted = await submitCatalogSyncJob({
      vendorId: syncRun.vendor_id,
      mappingId: syncRun.endpoint_mapping_id ?? undefined,
      syncAll: syncRun.sync_scope === 'ALL',
      sourceAction: continuation.sourceAction,
      correlationId: continuation.correlationId,
      requestPayload: {
        continuation: {
          start_reference_index: continuation.nextStartReferenceIndex,
          max_references_per_run: continuation.maxReferencesPerRun,
          initial_last_successful_sync_at: continuation.initialLastSuccessfulSyncAt,
        },
        source_sync_run_id: syncRun.etl_sync_run_id,
      },
    });

    await markSyncRunContinuationEnqueued({
      syncRunId: syncRun.etl_sync_run_id,
      integrationJobId: submitted.job.integration_job_id,
      deduplicated: submitted.deduplicated,
    });

    if (submitted.deduplicated) {
      deduplicated += 1;
    } else {
      queued += 1;
    }
  }

  logger.info('catalog continuation scheduler evaluated pending sync runs', {
    scanned: pendingRuns.length,
    queued,
    deduplicated,
    skipped,
  });

  return {
    queued,
    deduplicated,
    skipped,
    scanned: pendingRuns.length,
  };
}
