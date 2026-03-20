import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import { getOrderOperatorDetail } from '../../../lib/orders/operatorOrders';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const orderIntegrationStateId = Number(req.query.orderIntegrationStateId);

  return runWithRequestContext(
    buildApiRequestContext(req, { orderIntegrationStateId }),
    async () => {
      logger.info('order integration detail API request', {
        method: req.method,
        orderIntegrationStateId,
      });

      try {
        const session = await getSession(req);
        if (!session) {
          return res.status(401).json({ message: 'Unauthorized' });
        }

        if (!Number.isFinite(orderIntegrationStateId)) {
          return res.status(400).json({ message: 'Invalid orderIntegrationStateId' });
        }

        if (req.method !== 'GET') {
          res.setHeader('Allow', ['GET']);
          return res.status(405).json({ message: `Method ${req.method} not allowed` });
        }

        const detail = await getOrderOperatorDetail(orderIntegrationStateId);
        return res.status(200).json(detail);
      } catch (error: any) {
        await recordInternalFailure({
          action: 'order_integration_detail_api_request',
          payload: {
            method: req.method ?? 'UNKNOWN',
            url: req.url ?? '',
            order_integration_state_id: orderIntegrationStateId,
          },
          error,
        });
        const { message, response, statusCode } = error;
        return res.status(response?.status || statusCode || 500).json({
          message: message ?? 'Order integration detail lookup failed',
        });
      }
    },
  );
}
