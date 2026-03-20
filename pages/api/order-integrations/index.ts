import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import {
  createOrderIntegrationAndMaybeSubmit,
  type CreateOrderIntegrationInput,
} from '../../../lib/orders/orderCoordinator';
import { listOrderOperatorSummaries } from '../../../lib/orders/operatorOrders';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';

interface CreateOrderIntegrationBody extends CreateOrderIntegrationInput {}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('order integrations API request', {
      method: req.method,
    });

    try {
      const session = await getSession(req);
      if (!session) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (req.method === 'GET') {
        const vendorId = Number(req.query.vendorId);
        const data = await listOrderOperatorSummaries(Number.isFinite(vendorId) ? vendorId : undefined);
        return res.status(200).json({ data });
      }

      if (req.method === 'POST') {
        const body = req.body as CreateOrderIntegrationBody;
        const result = await createOrderIntegrationAndMaybeSubmit(body);
        return res.status(201).json({
          data: result.orderIntegrationState,
          job: result.submittedJob?.job ?? null,
          events: result.submittedJob?.events ?? [],
          deduplicated: result.submittedJob?.deduplicated ?? false,
        });
      }

      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ message: `Method ${req.method} not allowed` });
    } catch (error: any) {
      await recordInternalFailure({
        action: 'order_integrations_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response, statusCode } = error;
      return res.status(response?.status || statusCode || 500).json({
        message: message ?? 'Order integrations API error',
      });
    }
  });
}
