import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../lib/auth';
import { recordInternalFailure } from '../../../../lib/apiTelemetry';
import logger from '../../../../lib/logger';
import {
  enqueueManualOrderPoll,
  submitExistingOrderIntegration,
  submitOrderRemittance,
} from '../../../../lib/orders/orderCoordinator';
import { buildApiRequestContext, runWithRequestContext } from '../../../../lib/requestContext';

type OrderAction =
  | 'submit'
  | 'retry_submission'
  | 'poll_status'
  | 'poll_shipment'
  | 'poll_invoice'
  | 'submit_remittance';

interface OrderActionBody {
  action?: OrderAction;
  remittance_payload?: Record<string, unknown>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const orderIntegrationStateId = Number(req.query.orderIntegrationStateId);

  return runWithRequestContext(
    buildApiRequestContext(req, { orderIntegrationStateId }),
    async () => {
      logger.info('order integration action API request', {
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

        if (req.method !== 'POST') {
          res.setHeader('Allow', ['POST']);
          return res.status(405).json({ message: `Method ${req.method} not allowed` });
        }

        const body = (req.body ?? {}) as OrderActionBody;
        let result;
        switch (body.action) {
          case 'submit':
          case 'retry_submission':
            result = await submitExistingOrderIntegration(orderIntegrationStateId, {
              sourceAction:
                body.action === 'submit' ? 'operator_manual_submission' : 'operator_retry_submission',
            });
            break;
          case 'poll_status':
            result = await enqueueManualOrderPoll(
              orderIntegrationStateId,
              'ORDER_STATUS_POLL',
              'operator_manual_status_poll',
            );
            break;
          case 'poll_shipment':
            result = await enqueueManualOrderPoll(
              orderIntegrationStateId,
              'ORDER_SHIPMENT_POLL',
              'operator_manual_shipment_poll',
            );
            break;
          case 'poll_invoice':
            result = await enqueueManualOrderPoll(
              orderIntegrationStateId,
              'ORDER_INVOICE_POLL',
              'operator_manual_invoice_poll',
            );
            break;
          case 'submit_remittance':
            result = await submitOrderRemittance(orderIntegrationStateId, body.remittance_payload ?? {});
            break;
          default:
            return res.status(400).json({ message: 'Unsupported order action.' });
        }

        return res.status(202).json({
          data: result.job,
          events: result.events,
          deduplicated: result.deduplicated,
        });
      } catch (error: any) {
        await recordInternalFailure({
          action: 'order_integration_action_api_request',
          payload: {
            method: req.method ?? 'UNKNOWN',
            url: req.url ?? '',
            order_integration_state_id: orderIntegrationStateId,
            body: typeof req.body === 'object' ? req.body : {},
          },
          error,
        });
        const { message, response, statusCode } = error;
        return res.status(response?.status || statusCode || 500).json({
          message: message ?? 'Order integration action failed',
        });
      }
    },
  );
}
