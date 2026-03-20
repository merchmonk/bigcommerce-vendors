import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../lib/auth';
import { recordInternalFailure } from '../../../../lib/apiTelemetry';
import logger from '../../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../../lib/requestContext';
import { getOperatorTraceSnapshot } from '../../../../lib/vendors/operatorDiagnostics';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const traceId = Number(req.query.traceId);

  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('operator trace snapshot API request', {
      method: req.method,
      operatorTraceId: traceId,
    });

    try {
      const session = await getSession(req);
      if (!session) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (!Number.isFinite(traceId)) {
        return res.status(400).json({ message: 'Invalid traceId' });
      }

      if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} not allowed` });
      }

      const snapshot = await getOperatorTraceSnapshot(traceId);
      return res.status(200).json({ data: snapshot });
    } catch (error: any) {
      await recordInternalFailure({
        action: 'operator_trace_snapshot_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          operator_trace_id: traceId,
        },
        error,
      });
      const { message, response, statusCode } = error;
      return res.status(response?.status || statusCode || 500).json({
        message: message ?? 'Operator trace snapshot lookup failed',
      });
    }
  });
}
