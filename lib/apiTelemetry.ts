import logger from './logger';
import { createOperatorTrace } from './etl/repository';
import { getRequestContext } from './requestContext';
import { writeSnapshotArchive, type SnapshotArchiveReference } from './snapshotArchive';
import { serializeError } from './telemetry';

interface RecordApiExchangeInput {
  category: 'vendor-api' | 'bigcommerce-api';
  target: string;
  method: string;
  action: string;
  status?: number;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  error?: unknown;
}

export async function recordApiExchange(
  input: RecordApiExchangeInput,
): Promise<SnapshotArchiveReference | null> {
  const context = getRequestContext();
  const snapshotReference = await writeSnapshotArchive({
    category: input.category,
    action: input.action,
    payload: {
      target: input.target,
      method: input.method,
      status: input.status,
      request: input.request,
      response: input.response,
      error: input.error ? serializeError(input.error) : undefined,
    },
  }).catch(error => {
    logger.warn('snapshot archive write failed', {
      action: input.action,
      target: input.target,
      error: serializeError(error),
    });
    return null;
  });

  await createOperatorTrace({
    category: input.category === 'vendor-api' ? 'VENDOR_API' : 'BIGCOMMERCE_API',
    correlation_id: context?.correlationId ?? 'unknown',
    vendor_id: context?.vendorId ?? null,
    integration_job_id: context?.integrationJobId ?? null,
    order_integration_state_id: context?.orderIntegrationStateId ?? null,
    sync_run_id: context?.syncRunId ?? null,
    method: input.method,
    target: input.target,
    action: input.action,
    status_code: input.status ?? null,
    snapshot_bucket: snapshotReference?.bucket ?? null,
    snapshot_key: snapshotReference?.key ?? null,
    metadata: {
      has_error: Boolean(input.error),
    },
  }).catch(error => {
    logger.warn('operator trace write failed', {
      action: input.action,
      target: input.target,
      error: serializeError(error),
    });
    return null;
  });

  logger.info('external api call completed', {
    category: input.category,
    target: input.target,
    method: input.method,
    status: input.status,
    snapshot: snapshotReference,
    hasError: Boolean(input.error),
  });

  return snapshotReference;
}

export async function recordInternalFailure(input: {
  action: string;
  payload: Record<string, unknown>;
  error: unknown;
}): Promise<SnapshotArchiveReference | null> {
  const context = getRequestContext();
  const snapshotReference = await writeSnapshotArchive({
    category: 'internal-failure',
    action: input.action,
    payload: {
      ...input.payload,
      error: serializeError(input.error),
    },
  }).catch(error => {
    logger.warn('internal failure snapshot archive write failed', {
      action: input.action,
      error: serializeError(error),
    });
    return null;
  });

  await createOperatorTrace({
    category: 'INTERNAL_FAILURE',
    correlation_id: context?.correlationId ?? 'unknown',
    vendor_id: context?.vendorId ?? null,
    integration_job_id: context?.integrationJobId ?? null,
    order_integration_state_id: context?.orderIntegrationStateId ?? null,
    sync_run_id: context?.syncRunId ?? null,
    method: typeof input.payload.method === 'string' ? input.payload.method : 'UNKNOWN',
    target: typeof input.payload.url === 'string' ? input.payload.url : input.action,
    action: input.action,
    snapshot_bucket: snapshotReference?.bucket ?? null,
    snapshot_key: snapshotReference?.key ?? null,
    metadata: {
      error: serializeError(input.error),
    },
  }).catch(error => {
    logger.warn('internal failure trace write failed', {
      action: input.action,
      error: serializeError(error),
    });
    return null;
  });

  logger.error('internal request boundary failed', {
    action: input.action,
    snapshot: snapshotReference,
    error: serializeError(input.error),
  });

  return snapshotReference;
}
