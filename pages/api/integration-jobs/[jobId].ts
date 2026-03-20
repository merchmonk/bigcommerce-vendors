import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { getIntegrationJobDiagnostics } from '../../../lib/vendors/operatorDiagnostics';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const integrationJobId = Number(req.query.jobId);
  return runWithRequestContext(buildApiRequestContext(req, { integrationJobId }), async () => {
    logger.info('integration job API request', {
      method: req.method,
      integrationJobId,
    });

    try {
      const session = await getSession(req);
      if (!session) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!Number.isFinite(integrationJobId)) {
        return res.status(400).json({ message: 'Invalid jobId' });
      }

      if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} not allowed` });
      }

      const payload = await getIntegrationJobDiagnostics(integrationJobId);
      return res.status(200).json(payload);
    } catch (error: any) {
      await recordInternalFailure({
        action: 'integration_job_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          integration_job_id: integrationJobId,
        },
        error,
      });
      const { message, response, statusCode } = error;
      return res.status(response?.status || statusCode || 500).json({ message: message ?? 'Integration job lookup failed' });
    }
  });
}
