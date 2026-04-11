import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../lib/auth';
import { recordInternalFailure } from '../../../../lib/apiTelemetry';
import {
  cancelIntegrationJob,
  getActiveCatalogSyncJobForVendor,
  getIntegrationJobStatus,
  submitCatalogSyncJob,
} from '../../../../lib/integrationJobs';
import logger from '../../../../lib/logger';
import { buildApiRequestContext, getRequestContext, runWithRequestContext } from '../../../../lib/requestContext';
import { listSyncRunsForVendor, reconcileStaleCatalogSyncRunsForVendor } from '../../../../lib/etl/repository';

interface RunSyncBody {
  mapping_id?: number;
  sync_all?: boolean;
  integration_job_id?: number;
  action?: 'cancel';
  start_reference_index?: number | string;
  max_references_per_run?: number | string;
}

interface ResumeCheckpoint {
  sync_run_id: number;
  start_reference_index: number;
  status: string;
  last_processed_product_id?: string;
  last_processed_sku?: string;
}

type SyncRunRecord = Awaited<ReturnType<typeof listSyncRunsForVendor>>[number];

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function buildResumeCheckpoint(run: SyncRunRecord): ResumeCheckpoint | null {
  if (run.sync_scope !== 'ALL') {
    return null;
  }

  const details = asRecord(run.details);
  const progress = asRecord(details.progress);
  const continuation = asRecord(details.continuation);
  const processedReferences = readInteger(progress.processed_references);
  const continuationStartIndex = readInteger(continuation.next_start_reference_index);

  if (run.status !== 'SUCCESS' && processedReferences !== null && processedReferences > 0) {
    return {
      sync_run_id: run.etl_sync_run_id,
      start_reference_index: processedReferences,
      status: run.status,
      last_processed_product_id: readString(progress.current_product_id),
      last_processed_sku: readString(progress.current_sku),
    };
  }

  if (
    run.status === 'SUCCESS' &&
    continuation.enqueued !== true &&
    continuationStartIndex !== null &&
    continuationStartIndex > 0
  ) {
    return {
      sync_run_id: run.etl_sync_run_id,
      start_reference_index: continuationStartIndex,
      status: run.status,
      last_processed_product_id: readString(progress.current_product_id),
      last_processed_sku: readString(progress.current_sku),
    };
  }

  return null;
}

function findLatestResumeCheckpoint(runs: SyncRunRecord[]): ResumeCheckpoint | null {
  for (const run of runs) {
    const checkpoint = buildResumeCheckpoint(run);
    if (checkpoint) {
      return checkpoint;
    }
  }

  return null;
}

function readOptionalInteger(value: unknown, options: { min: number; fieldName: string }): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < options.min) {
    const error = new Error(`${options.fieldName} must be an integer greater than or equal to ${options.min}.`);
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }

  return parsed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  return runWithRequestContext(buildApiRequestContext(req, { vendorId }), async () => {
    logger.info('vendor sync API request', { method: req.method, vendorId });

   // try {
      const session = await getSession(req);
      if (!session) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!Number.isFinite(vendorId)) {
        return res.status(400).json({ message: 'Invalid vendorId' });
      }

      if (req.method === 'GET') {
        await reconcileStaleCatalogSyncRunsForVendor(vendorId);
        const activeJob = await getActiveCatalogSyncJobForVendor(vendorId);
        const runs = await listSyncRunsForVendor(vendorId);
        const resumeCheckpoint = findLatestResumeCheckpoint(runs);
        return res.status(200).json({ data: runs, active_job: activeJob, resume_checkpoint: resumeCheckpoint });
      }

      if (req.method === 'POST') {
        const body = req.body as RunSyncBody;
        const startReferenceIndex = readOptionalInteger(body.start_reference_index, {
          min: 0,
          fieldName: 'start_reference_index',
        });
        const maxReferencesPerRun = readOptionalInteger(body.max_references_per_run, {
          min: 1,
          fieldName: 'max_references_per_run',
        });
        if (body.action === 'cancel') {
          const activeJob = body.integration_job_id
            ? await getIntegrationJobStatus(body.integration_job_id).then(result => result.job)
            : await getActiveCatalogSyncJobForVendor(vendorId);

          if (!activeJob || activeJob.vendor_id !== vendorId) {
            return res.status(404).json({ message: 'No active vendor sync job found to cancel.' });
          }

          const cancelled = await cancelIntegrationJob(activeJob.integration_job_id);
          return res.status(202).json({
            data: cancelled.job,
            events: cancelled.events,
          });
        }

        const submittedJob = await submitCatalogSyncJob({
          vendorId,
          mappingId: body.mapping_id,
          syncAll: body.sync_all,
          sourceAction: 'manual_sync',
          correlationId: getRequestContext()?.correlationId ?? 'unknown',
          requestPayload: {
            mapping_id: body.mapping_id ?? null,
            sync_all: body.sync_all ?? false,
            ...(startReferenceIndex !== undefined || maxReferencesPerRun !== undefined
              ? {
                  continuation: {
                    ...(startReferenceIndex !== undefined
                      ? { start_reference_index: startReferenceIndex }
                      : {}),
                    ...(maxReferencesPerRun !== undefined
                      ? { max_references_per_run: maxReferencesPerRun }
                      : {}),
                  },
                }
              : {}),
          },
        });
        const status = await getIntegrationJobStatus(submittedJob.job.integration_job_id);
        return res.status(202).json({
          data: status.job,
          events: status.events,
          deduplicated: submittedJob.deduplicated,
        });
      }

      if (req.method === 'DELETE') {
        const body = (req.body ?? {}) as RunSyncBody;
        const activeJob = body.integration_job_id
          ? await getIntegrationJobStatus(body.integration_job_id).then(result => result.job)
          : await getActiveCatalogSyncJobForVendor(vendorId);

        if (!activeJob || activeJob.vendor_id !== vendorId) {
          return res.status(404).json({ message: 'No active vendor sync job found to cancel.' });
        }

        const cancelled = await cancelIntegrationJob(activeJob.integration_job_id);
        return res.status(202).json({
          data: cancelled.job,
          events: cancelled.events,
        });
      }

      res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
      return res.status(405).json({ message: `Method ${req.method} not allowed` });
    /*} catch (error: any) {
      await recordInternalFailure({
        action: 'vendor_sync_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          vendor_id: vendorId,
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response, statusCode } = error;
      return res.status(response?.status || statusCode || 500).json({ message: message ?? 'Vendor sync failed' });
    }*/
  });
}
