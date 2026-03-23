import { SendMessageCommand } from '@aws-sdk/client-sqs';
import type { IntegrationJob, IntegrationJobEvent, IntegrationJobKind } from '../types';
import { getSqsClient } from './awsClients';
import logger from './logger';
import { publishPlatformEvent } from './platformEvents';
import {
  createIntegrationJob,
  createIntegrationJobEvent,
  finalizeIntegrationJob,
  findActiveIntegrationJobByDedupeKey,
  findLatestActiveCatalogSyncJobForVendor,
  getIntegrationJobById,
  listIntegrationJobEvents,
  markIntegrationJobEnqueued,
  requestIntegrationJobCancellation,
} from './etl/repository';
import { serializeError } from './telemetry';

export interface CatalogSyncJobRequest {
  vendorId: number;
  mappingId?: number;
  syncAll?: boolean;
  sourceAction: 'vendor_create_auto_sync' | 'manual_sync' | 'manual_inventory_sync';
  correlationId: string;
  requestPayload?: Record<string, unknown>;
}

export interface IntegrationJobMessage {
  integrationJobId: number;
}

export interface OrderLifecycleJobRequest {
  vendorId: number;
  orderIntegrationStateId: number;
  jobKind: Extract<
    IntegrationJobKind,
    | 'ORDER_SUBMISSION'
    | 'ORDER_STATUS_POLL'
    | 'ORDER_SHIPMENT_POLL'
    | 'ORDER_INVOICE_POLL'
    | 'ORDER_REMITTANCE_SUBMISSION'
  >;
  sourceAction: string;
  correlationId: string;
  requestPayload?: Record<string, unknown>;
}

function getIntegrationQueueUrl(): string {
  const queueUrl = process.env.INTEGRATION_JOB_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('INTEGRATION_JOB_QUEUE_URL is not configured.');
  }
  return queueUrl;
}

export function buildCatalogSyncDedupeKey(input: {
  vendorId: number;
  mappingId?: number;
  syncAll?: boolean;
  sourceAction: CatalogSyncJobRequest['sourceAction'];
  requestPayload?: Record<string, unknown>;
}): string {
  const syncScope = input.syncAll ? 'ALL' : 'MAPPING';
  const mappingScope = input.mappingId ?? 'all';
  const continuationStartIndex = readContinuationStartIndex(input.requestPayload);

  if (continuationStartIndex === null) {
    return `catalog_sync:${input.vendorId}:${syncScope}:${mappingScope}:${input.sourceAction}`;
  }

  return `catalog_sync:${input.vendorId}:${syncScope}:${mappingScope}:${input.sourceAction}:${continuationStartIndex}`;
}

function readContinuationStartIndex(requestPayload?: Record<string, unknown>): number | null {
  const continuation = requestPayload?.continuation;
  if (!continuation || typeof continuation !== 'object') {
    return null;
  }

  const startReferenceIndex = (continuation as { start_reference_index?: unknown }).start_reference_index;
  if (typeof startReferenceIndex !== 'number' || !Number.isFinite(startReferenceIndex)) {
    return null;
  }

  return startReferenceIndex;
}

export function buildOrderLifecycleDedupeKey(input: {
  vendorId: number;
  orderIntegrationStateId: number;
  jobKind: OrderLifecycleJobRequest['jobKind'];
}): string {
  return `order_job:${input.jobKind}:${input.vendorId}:${input.orderIntegrationStateId}`;
}

async function enqueueIntegrationJob(input: {
  jobKind: IntegrationJobKind;
  vendorId: number;
  mappingId?: number | null;
  orderIntegrationStateId?: number | null;
  syncScope?: 'MAPPING' | 'ALL';
  sourceAction: string;
  correlationId: string;
  dedupeKey: string;
  requestPayload?: Record<string, unknown>;
  jobSubmittedEventName: string;
  queueEnqueuedEventName: string;
  platformDetailType: string;
  platformDetail: Record<string, unknown>;
}): Promise<{
  job: IntegrationJob;
  deduplicated: boolean;
}> {
  const existingJob = await findActiveIntegrationJobByDedupeKey(input.dedupeKey);
  if (existingJob) {
    await createIntegrationJobEvent({
      integration_job_id: existingJob.integration_job_id,
      event_name: 'job_reused',
      payload: {
        dedupe_key: input.dedupeKey,
        source_action: input.sourceAction,
      },
    });
    logger.info('integration job reused', {
      integrationJobId: existingJob.integration_job_id,
      dedupeKey: input.dedupeKey,
    });
    return {
      job: existingJob,
      deduplicated: true,
    };
  }

  const job = await createIntegrationJob({
    job_kind: input.jobKind,
    vendor_id: input.vendorId,
    mapping_id: input.mappingId ?? null,
    order_integration_state_id: input.orderIntegrationStateId ?? null,
    sync_scope: input.syncScope ?? 'ALL',
    source_action: input.sourceAction,
    dedupe_key: input.dedupeKey,
    correlation_id: input.correlationId,
    request_payload: input.requestPayload,
  });

  await createIntegrationJobEvent({
    integration_job_id: job.integration_job_id,
    event_name: input.jobSubmittedEventName,
    payload: {
      dedupe_key: input.dedupeKey,
      source_action: input.sourceAction,
      job_kind: input.jobKind,
      order_integration_state_id: input.orderIntegrationStateId ?? null,
    },
  });

  let queueResponse: { MessageId?: string } | undefined;
  try {
    const queueUrl = getIntegrationQueueUrl();
    queueResponse = await getSqsClient().send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify({
          integrationJobId: job.integration_job_id,
        } satisfies IntegrationJobMessage),
      }),
    );
  } catch (error) {
    await finalizeIntegrationJob({
      integration_job_id: job.integration_job_id,
      status: 'FAILED',
      last_error: JSON.stringify(serializeError(error)),
    });
    await createIntegrationJobEvent({
      integration_job_id: job.integration_job_id,
      event_name: 'job_enqueue_failed',
      level: 'error',
      payload: {
        error: serializeError(error),
      },
    });
    logger.error('integration job enqueue failed', {
      integrationJobId: job.integration_job_id,
      error: serializeError(error),
    });
    throw error;
  }

  const enqueuedJob = await markIntegrationJobEnqueued(job.integration_job_id, queueResponse.MessageId ?? null);
  await createIntegrationJobEvent({
    integration_job_id: job.integration_job_id,
    event_name: input.queueEnqueuedEventName,
    payload: {
      queue_message_id: queueResponse.MessageId ?? null,
      job_kind: input.jobKind,
    },
  });
  await publishPlatformEvent({
    detailType: input.platformDetailType,
    detail: {
      integration_job_id: job.integration_job_id,
      vendor_id: job.vendor_id,
      mapping_id: job.mapping_id,
      order_integration_state_id: job.order_integration_state_id,
      sync_scope: job.sync_scope,
      source_action: job.source_action,
      job_kind: job.job_kind,
      ...input.platformDetail,
    },
  });
  logger.info('integration job enqueued', {
    integrationJobId: job.integration_job_id,
    queueMessageId: queueResponse.MessageId ?? null,
    jobKind: job.job_kind,
  });

  return {
    job: enqueuedJob ?? job,
    deduplicated: false,
  };
}

export async function submitCatalogSyncJob(input: CatalogSyncJobRequest): Promise<{
  job: IntegrationJob;
  deduplicated: boolean;
}> {
  const dedupeKey = buildCatalogSyncDedupeKey(input);
  return enqueueIntegrationJob({
    jobKind: 'CATALOG_SYNC',
    vendorId: input.vendorId,
    mappingId: input.mappingId ?? null,
    syncScope: input.syncAll ? 'ALL' : 'MAPPING',
    sourceAction: input.sourceAction,
    correlationId: input.correlationId,
    dedupeKey,
    requestPayload: input.requestPayload,
    jobSubmittedEventName: 'job_submitted',
    queueEnqueuedEventName: 'job_enqueued',
    platformDetailType: 'product.sync.submitted',
    platformDetail: {
      sync_scope: input.syncAll ? 'ALL' : 'MAPPING',
    },
  });
}

export async function submitOrderLifecycleJob(input: OrderLifecycleJobRequest): Promise<{
  job: IntegrationJob;
  deduplicated: boolean;
}> {
  const dedupeKey = buildOrderLifecycleDedupeKey({
    vendorId: input.vendorId,
    orderIntegrationStateId: input.orderIntegrationStateId,
    jobKind: input.jobKind,
  });

  return enqueueIntegrationJob({
    jobKind: input.jobKind,
    vendorId: input.vendorId,
    orderIntegrationStateId: input.orderIntegrationStateId,
    syncScope: 'ALL',
    sourceAction: input.sourceAction,
    correlationId: input.correlationId,
    dedupeKey,
    requestPayload: input.requestPayload,
    jobSubmittedEventName: 'order_job_submitted',
    queueEnqueuedEventName: 'order_job_enqueued',
    platformDetailType: 'order.job.submitted',
    platformDetail: {
      order_integration_state_id: input.orderIntegrationStateId,
    },
  });
}

export async function getIntegrationJobStatus(integrationJobId: number): Promise<{
  job: IntegrationJob;
  events: IntegrationJobEvent[];
}> {
  const job = await getIntegrationJobById(integrationJobId);
  if (!job) {
    const error = new Error(`Integration job ${integrationJobId} not found`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  const events = await listIntegrationJobEvents(integrationJobId, 25);
  return {
    job,
    events,
  };
}

export async function getActiveCatalogSyncJobForVendor(vendorId: number): Promise<IntegrationJob | null> {
  return findLatestActiveCatalogSyncJobForVendor(vendorId);
}

export async function cancelIntegrationJob(integrationJobId: number): Promise<{
  job: IntegrationJob;
  events: IntegrationJobEvent[];
}> {
  const job = await requestIntegrationJobCancellation(integrationJobId);
  if (!job) {
    const error = new Error(`Integration job ${integrationJobId} not found`) as Error & {
      statusCode?: number;
    };
    error.statusCode = 404;
    throw error;
  }

  await createIntegrationJobEvent({
    integration_job_id: integrationJobId,
    event_name: job.status === 'CANCELLED' ? 'job_cancelled' : 'job_cancel_requested',
    level: 'warn',
    payload: {
      status: job.status,
    },
  });

  logger.warn('integration job cancellation updated', {
    integrationJobId: job.integration_job_id,
    status: job.status,
  });

  const events = await listIntegrationJobEvents(integrationJobId, 25);
  return {
    job,
    events,
  };
}
