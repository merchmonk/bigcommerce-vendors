import { getSystemSessionContext } from '../lib/auth';
import { getIntegrationJobStatus, type IntegrationJobMessage } from '../lib/integrationJobs';
import logger from '../lib/logger';
import { executeOrderLifecycleJob } from '../lib/orders/orderExecution';
import { publishPlatformEvent } from '../lib/platformEvents';
import { mergeRequestContext, runWithRequestContext } from '../lib/requestContext';
import { runVendorSync } from '../lib/etl/runner';
import {
  createIntegrationJobEvent,
  finalizeIntegrationJob,
  getIntegrationJobById,
  markIntegrationJobRunning,
  updateIntegrationJob,
} from '../lib/etl/repository';
import { serializeError } from '../lib/telemetry';
import { withOrderIntegrationExecutionLock, withVendorExecutionLock } from '../lib/vendorExecutionLock';

interface QueueRecord {
  body: string;
  attributes?: Record<string, string>;
}

interface QueueEvent {
  Records: QueueRecord[];
}

interface CatalogSyncContinuationPayload {
  start_reference_index?: number;
  max_references_per_run?: number;
  initial_last_successful_sync_at?: string | null;
}

function getMaxReceiveCount(): number {
  const value = Number(process.env.INTEGRATION_JOB_MAX_RECEIVE_COUNT ?? '5');
  return Number.isFinite(value) && value > 0 ? value : 5;
}

function isTerminalReceiveAttempt(receiveCount: number): boolean {
  return receiveCount >= getMaxReceiveCount();
}

function isCancelledIntegrationJobError(error: unknown): boolean {
  return error instanceof Error && error.name === 'IntegrationJobCancelledError';
}

function isNonRetryableIntegrationJobError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('No BigCommerce store connection is configured for background execution.')) {
    return true;
  }

  const bigCommerceStatusMatch = message.match(/Failed to .*BigCommerce.*\((\d{3})\):/i);
  if (bigCommerceStatusMatch) {
    const statusCode = Number(bigCommerceStatusMatch[1]);
    if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return true;
    }
  }

  const normalized = message.toLowerCase();
  if (!normalized.includes('productdata discovery failed')) {
    return false;
  }

  const nonRetryableSoapPatterns = [
    'required',
    'missing',
    'invalid',
    'must be provided',
    'cannot be empty',
    'validation',
    'not found',
    'partid',
    'productid',
    'lineitem',
    'quantity',
    'purchaseordernumber',
    'salesordernumber',
    'querytype',
    'invoice',
    'remittance',
    'soapaction',
    'procedure',
    'wsversion',
  ];

  return nonRetryableSoapPatterns.some(pattern => normalized.includes(pattern));
}

async function markJobRetryPending(integrationJobId: number, error: unknown, receiveCount: number): Promise<void> {
  await updateIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'ENQUEUED',
    last_error: JSON.stringify(serializeError(error)),
  });
  await createIntegrationJobEvent({
    integration_job_id: integrationJobId,
    event_name: 'job_retry_scheduled',
    level: 'warn',
    payload: {
      receive_count: receiveCount,
      error: serializeError(error),
    },
  });
}

async function markJobDeadLettered(integrationJobId: number, error: unknown, receiveCount: number): Promise<void> {
  await finalizeIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'DEAD_LETTERED',
    last_error: JSON.stringify(serializeError(error)),
  });
  await createIntegrationJobEvent({
    integration_job_id: integrationJobId,
    event_name: 'job_dead_lettered',
    level: 'error',
    payload: {
      receive_count: receiveCount,
      error: serializeError(error),
    },
  });
}

async function markJobFailed(integrationJobId: number, error: unknown, receiveCount: number): Promise<void> {
  await finalizeIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'FAILED',
    last_error: JSON.stringify(serializeError(error)),
  });
  await createIntegrationJobEvent({
    integration_job_id: integrationJobId,
    event_name: 'job_failed',
    level: 'error',
    payload: {
      receive_count: receiveCount,
      error: serializeError(error),
    },
  });
}

async function markJobCancelled(integrationJobId: number, reason: string, receiveCount: number): Promise<void> {
  await finalizeIntegrationJob({
    integration_job_id: integrationJobId,
    status: 'CANCELLED',
    last_error: reason,
  });
  await createIntegrationJobEvent({
    integration_job_id: integrationJobId,
    event_name: 'job_cancelled',
    level: 'warn',
    payload: {
      receive_count: receiveCount,
      reason,
    },
  });
}

async function processRecord(record: QueueRecord): Promise<void> {
  const message = JSON.parse(record.body) as IntegrationJobMessage;
  const integrationJobId = Number(message.integrationJobId);
  if (!Number.isFinite(integrationJobId)) {
    throw new Error('Integration job message is missing a valid integrationJobId.');
  }

  const job = await getIntegrationJobById(integrationJobId);
  if (!job) {
    logger.warn('integration job missing for worker record', { integrationJobId });
    return;
  }

  const receiveCount = Number(record.attributes?.ApproximateReceiveCount ?? '1');

  await runWithRequestContext(
    {
      correlationId: job.correlation_id,
      vendorId: job.vendor_id,
      integrationJobId: job.integration_job_id,
      orderIntegrationStateId: job.order_integration_state_id ?? undefined,
      source: 'worker',
    },
    async () => {
      if (job.status === 'SUCCEEDED' || job.status === 'DEAD_LETTERED' || job.status === 'CANCELLED') {
        logger.info('integration job already terminal, skipping worker record', {
          integrationJobId,
          status: job.status,
        });
        return;
      }

      if (job.status === 'CANCEL_REQUESTED') {
        await markJobCancelled(job.integration_job_id, 'Cancelled by operator before execution started.', receiveCount);
        logger.warn('integration job cancelled before execution started', {
          integrationJobId: job.integration_job_id,
          receiveCount,
        });
        return;
      }

      try {
        const lockResult = await acquireJobExecutionLock(job, async () => {
          const runningJob = await markIntegrationJobRunning(job.integration_job_id, job.attempt_count + 1);
          if (!runningJob) {
            throw new Error(`Failed to mark integration job ${job.integration_job_id} as RUNNING`);
          }

          mergeRequestContext({
            integrationJobId: runningJob.integration_job_id,
            orderIntegrationStateId: runningJob.order_integration_state_id ?? undefined,
          });
          await createIntegrationJobEvent({
            integration_job_id: runningJob.integration_job_id,
            event_name: 'job_started',
            payload: {
              attempt_count: runningJob.attempt_count,
              receive_count: receiveCount,
              job_kind: runningJob.job_kind,
              order_integration_state_id: runningJob.order_integration_state_id,
            },
          });
          await publishPlatformEvent(getJobStartedEvent(runningJob));

          const executionSummary = await executeIntegrationJob(runningJob);

          await finalizeIntegrationJob({
            integration_job_id: runningJob.integration_job_id,
            status: 'SUCCEEDED',
          });
          await createIntegrationJobEvent({
            integration_job_id: runningJob.integration_job_id,
            event_name: 'job_succeeded',
            payload: executionSummary.eventPayload,
          });
          await publishPlatformEvent(getJobSucceededEvent(runningJob, executionSummary.eventPayload));
          logger.info('integration job completed successfully', {
            integrationJobId: runningJob.integration_job_id,
            jobKind: runningJob.job_kind,
            ...executionSummary.logPayload,
          });
        });

        if (!lockResult.acquired) {
          await createIntegrationJobEvent({
            integration_job_id: job.integration_job_id,
            event_name: 'job_lock_unavailable',
            level: 'warn',
            payload: {
              receive_count: receiveCount,
            },
          });
          throw new Error(getLockUnavailableMessage(job));
        }
      } catch (error) {
        if (isCancelledIntegrationJobError(error)) {
          await markJobCancelled(job.integration_job_id, error.message, receiveCount);
          await publishPlatformEvent({
            detailType: job.job_kind === 'CATALOG_SYNC' ? 'product.sync.cancelled' : 'order.job.cancelled',
            detail: {
              integration_job_id: job.integration_job_id,
              vendor_id: job.vendor_id,
              mapping_id: job.mapping_id,
              order_integration_state_id: job.order_integration_state_id,
              job_kind: job.job_kind,
              sync_scope: job.sync_scope,
              receive_count: receiveCount,
              reason: error.message,
            },
          });
          logger.warn('integration job cancelled during execution', {
            integrationJobId: job.integration_job_id,
            jobKind: job.job_kind,
            receiveCount,
            reason: error.message,
          });
          return;
        }

        const nonRetryable = isNonRetryableIntegrationJobError(error);
        const terminal = nonRetryable || isTerminalReceiveAttempt(receiveCount);
        if (nonRetryable) {
          await markJobFailed(job.integration_job_id, error, receiveCount);
        } else if (terminal) {
          await markJobDeadLettered(job.integration_job_id, error, receiveCount);
        } else {
          await markJobRetryPending(job.integration_job_id, error, receiveCount);
        }

        await publishPlatformEvent({
          ...getJobFailedEvent(job, receiveCount, terminal, error),
        });
        logger.error('integration job execution failed', {
          integrationJobId: job.integration_job_id,
          jobKind: job.job_kind,
          receiveCount,
          nonRetryable,
          terminal,
          error: serializeError(error),
        });
        throw error;
      }
    },
  );
}

async function acquireJobExecutionLock<T>(
  job: Awaited<ReturnType<typeof getIntegrationJobById>> extends infer TJob
    ? Exclude<TJob, null>
    : never,
  callback: () => Promise<T>,
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  if (job.job_kind === 'CATALOG_SYNC') {
    return withVendorExecutionLock(job.vendor_id, callback);
  }

  if (job.order_integration_state_id) {
    return withOrderIntegrationExecutionLock(job.order_integration_state_id, callback);
  }

  throw new Error(`Order integration job ${job.integration_job_id} is missing order_integration_state_id.`);
}

function getJobStartedEvent(job: NonNullable<Awaited<ReturnType<typeof markIntegrationJobRunning>>>) {
  if (job.job_kind === 'CATALOG_SYNC') {
    return {
      detailType: 'product.sync.started',
      detail: {
        integration_job_id: job.integration_job_id,
        vendor_id: job.vendor_id,
        mapping_id: job.mapping_id,
        sync_scope: job.sync_scope,
        attempt_count: job.attempt_count,
      },
    };
  }

  return {
    detailType: 'order.job.started',
    detail: {
      integration_job_id: job.integration_job_id,
      vendor_id: job.vendor_id,
      order_integration_state_id: job.order_integration_state_id,
      job_kind: job.job_kind,
      attempt_count: job.attempt_count,
    },
  };
}

function getLockUnavailableMessage(
  job: Awaited<ReturnType<typeof getIntegrationJobById>> extends infer TJob
    ? Exclude<TJob, null>
    : never,
): string {
  if (job.job_kind === 'CATALOG_SYNC') {
    return `Vendor ${job.vendor_id} is already running a sync job.`;
  }

  return `Order integration ${job.order_integration_state_id} is already running an order job.`;
}

async function executeIntegrationJob(job: NonNullable<Awaited<ReturnType<typeof markIntegrationJobRunning>>>) {
  if (job.job_kind === 'CATALOG_SYNC') {
    const session = await getSystemSessionContext();
    const continuation = readCatalogSyncContinuationPayload(job.request_payload);
    const result = await runVendorSync({
      vendorId: job.vendor_id,
      mappingId: job.mapping_id ?? undefined,
      syncAll: job.sync_scope === 'ALL',
      session,
      integrationJobId: job.integration_job_id,
      sourceAction: job.source_action,
      correlationId: job.correlation_id,
      continuation,
    });

    return {
      eventPayload: {
        sync_run_id: result.syncRunId,
        records_read: result.recordsRead,
        records_written: result.recordsWritten,
      },
      logPayload: {
        syncRunId: result.syncRunId,
      },
    };
  }

  const result = await executeOrderLifecycleJob(job);
  return {
    eventPayload: {
      order_integration_state_id: result.orderIntegrationState.order_integration_state_id,
      lifecycle_status: result.orderIntegrationState.lifecycle_status,
      summary: result.summary,
    },
    logPayload: {
      orderIntegrationStateId: result.orderIntegrationState.order_integration_state_id,
      lifecycleStatus: result.orderIntegrationState.lifecycle_status,
    },
  };
}

function readCatalogSyncContinuationPayload(requestPayload: unknown): CatalogSyncContinuationPayload | undefined {
  if (!requestPayload || typeof requestPayload !== 'object') {
    return undefined;
  }

  const continuation = (requestPayload as { continuation?: unknown }).continuation;
  if (!continuation || typeof continuation !== 'object') {
    return undefined;
  }

  const payload = continuation as CatalogSyncContinuationPayload;
  const hasKnownField =
    typeof payload.start_reference_index === 'number' ||
    typeof payload.max_references_per_run === 'number' ||
    typeof payload.initial_last_successful_sync_at === 'string' ||
    payload.initial_last_successful_sync_at === null;

  return hasKnownField ? payload : undefined;
}

function getJobSucceededEvent(
  job: NonNullable<Awaited<ReturnType<typeof markIntegrationJobRunning>>>,
  eventPayload: Record<string, unknown>,
) {
  if (job.job_kind === 'CATALOG_SYNC') {
    return {
      detailType: 'product.sync.succeeded',
      detail: {
        integration_job_id: job.integration_job_id,
        vendor_id: job.vendor_id,
        mapping_id: job.mapping_id,
        sync_scope: job.sync_scope,
        ...eventPayload,
      },
    };
  }

  return {
    detailType: 'order.job.succeeded',
    detail: {
      integration_job_id: job.integration_job_id,
      vendor_id: job.vendor_id,
      order_integration_state_id: job.order_integration_state_id,
      job_kind: job.job_kind,
      ...eventPayload,
    },
  };
}

function getJobFailedEvent(
  job: Awaited<ReturnType<typeof getIntegrationJobById>> extends infer TJob
    ? Exclude<TJob, null>
    : never,
  receiveCount: number,
  terminal: boolean,
  error: unknown,
) {
  if (job.job_kind === 'CATALOG_SYNC') {
    return {
      detailType: 'product.sync.failed',
      detail: {
        integration_job_id: job.integration_job_id,
        vendor_id: job.vendor_id,
        mapping_id: job.mapping_id,
        sync_scope: job.sync_scope,
        terminal,
        receive_count: receiveCount,
        error: serializeError(error),
      },
    };
  }

  return {
    detailType: 'order.job.failed',
    detail: {
      integration_job_id: job.integration_job_id,
      vendor_id: job.vendor_id,
      order_integration_state_id: job.order_integration_state_id,
      job_kind: job.job_kind,
      terminal,
      receive_count: receiveCount,
      error: serializeError(error),
    },
  };
}

export async function handler(event: QueueEvent): Promise<void> {
  for (const record of event.Records) {
    await processRecord(record);
  }
}

export async function loadIntegrationJobForDebug(integrationJobId: number) {
  return getIntegrationJobStatus(integrationJobId);
}
