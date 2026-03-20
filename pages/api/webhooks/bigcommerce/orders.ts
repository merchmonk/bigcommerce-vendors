import type { NextApiRequest, NextApiResponse } from 'next';
import { recordInternalFailure } from '../../../../lib/apiTelemetry';
import logger from '../../../../lib/logger';
import { intakeBigCommerceOrder } from '../../../../lib/orders/orderIntake';
import { buildApiRequestContext, runWithRequestContext } from '../../../../lib/requestContext';
import { assertProductPlatformRequestAuthorized } from '../../../../lib/storefront/productPlatformAuth';

interface BigCommerceWebhookBody {
  scope?: string;
  hash?: string;
  producer?: string;
  data?: {
    id?: number;
    type?: string;
  };
}

function parseWebhookOrderId(body: BigCommerceWebhookBody): number {
  const parsed = Number(body.data?.id);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error('Webhook payload is missing a valid order id.');
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return parsed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(
    buildApiRequestContext(req, {
      source: 'bigcommerce-webhook',
    }),
    async () => {
      logger.info('BigCommerce order webhook received', {
        method: req.method,
      });

      try {
        if (req.method !== 'POST') {
          res.setHeader('Allow', ['POST']);
          return res.status(405).json({ message: `Method ${req.method} not allowed` });
        }

        assertProductPlatformRequestAuthorized(req);

        const body = (req.body ?? {}) as BigCommerceWebhookBody;
        const orderId = parseWebhookOrderId(body);
        const result = await intakeBigCommerceOrder({
          orderId,
          source: 'BIGCOMMERCE_WEBHOOK',
          autoSubmit: true,
          metadata: {
            webhook_scope: body.scope ?? null,
            webhook_hash: body.hash ?? null,
            webhook_producer: body.producer ?? null,
          },
        });

        return res.status(200).json({
          received: true,
          order_id: orderId,
          created_count: result.created_count,
          deduplicated_count: result.deduplicated_count,
        });
      } catch (error: unknown) {
        const statusCode =
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof (error as { statusCode?: unknown }).statusCode === 'number'
            ? (error as { statusCode: number }).statusCode
            : 500;

        await recordInternalFailure({
          action: 'bigcommerce_order_webhook_request',
          payload: {
            method: req.method ?? 'UNKNOWN',
            url: req.url ?? '',
            body: typeof req.body === 'object' ? req.body : {},
          },
          error,
        });

        logger.error('BigCommerce order webhook failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          statusCode,
        });

        return res.status(statusCode).json({
          message: error instanceof Error ? error.message : 'Failed to process BigCommerce order webhook.',
        });
      }
    },
  );
}
