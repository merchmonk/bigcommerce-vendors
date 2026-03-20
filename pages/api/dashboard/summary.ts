import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { getOperatorDashboardSummary } from '../../../lib/vendors/operatorInsights';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('dashboard summary API request', { method: req.method });

    try {
      await getSession(req);
      if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} not allowed` });
      }

      const summary = await getOperatorDashboardSummary();
      return res.status(200).json({ data: summary });
    } catch (error: any) {
      await recordInternalFailure({
        action: 'dashboard_summary_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
        },
        error,
      });
      const { message, response } = error;
      return res.status(response?.status || 500).json({ message: message ?? 'Dashboard summary failed' });
    }
  });
}
