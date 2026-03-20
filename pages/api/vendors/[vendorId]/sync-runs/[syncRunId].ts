import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../../lib/auth';
import { recordInternalFailure } from '../../../../../lib/apiTelemetry';
import logger from '../../../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../../../lib/requestContext';
import { getSyncRunDiagnostics } from '../../../../../lib/vendors/operatorDiagnostics';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  const syncRunId = Number(req.query.syncRunId);

  return runWithRequestContext(buildApiRequestContext(req, { vendorId }), async () => {
    logger.info('vendor sync run diagnostics API request', {
      method: req.method,
      vendorId,
      syncRunId,
    });

    try {
      await getSession(req);

      if (!Number.isFinite(vendorId) || !Number.isFinite(syncRunId)) {
        return res.status(400).json({ message: 'Invalid vendorId or syncRunId' });
      }

      if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} not allowed` });
      }

      const diagnostics = await getSyncRunDiagnostics(syncRunId, vendorId);
      return res.status(200).json(diagnostics);
    } catch (error: any) {
      await recordInternalFailure({
        action: 'vendor_sync_run_diagnostics_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          vendor_id: vendorId,
          sync_run_id: syncRunId,
        },
        error,
      });
      const { message, response, statusCode } = error;
      return res.status(response?.status || statusCode || 500).json({
        message: message ?? 'Vendor sync run diagnostics failed',
      });
    }
  });
}
