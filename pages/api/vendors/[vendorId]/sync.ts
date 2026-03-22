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
import { listSyncRunsForVendor } from '../../../../lib/etl/repository';

interface RunSyncBody {
  mapping_id?: number;
  sync_all?: boolean;
  integration_job_id?: number;
  action?: 'cancel';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  return runWithRequestContext(buildApiRequestContext(req, { vendorId }), async () => {
    logger.info('vendor sync API request', { method: req.method, vendorId });

    try {
      const session = await getSession(req);
      if (!session) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!Number.isFinite(vendorId)) {
        return res.status(400).json({ message: 'Invalid vendorId' });
      }

      if (req.method === 'GET') {
        const [runs, activeJob] = await Promise.all([
          listSyncRunsForVendor(vendorId),
          getActiveCatalogSyncJobForVendor(vendorId),
        ]);
        return res.status(200).json({ data: runs, active_job: activeJob });
      }

      if (req.method === 'POST') {
        const body = req.body as RunSyncBody;
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
    } catch (error: any) {
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
      const { message, response } = error;
      return res.status(response?.status || 500).json({ message: message ?? 'Vendor sync failed' });
    }
  });
}
