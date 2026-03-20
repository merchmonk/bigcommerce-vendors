import type { NextApiRequest, NextApiResponse } from 'next';
import { recordInternalFailure } from '../../../../lib/apiTelemetry';
import logger from '../../../../lib/logger';
import { intakeBigCommerceOrder, type OrderIntakeSource } from '../../../../lib/orders/orderIntake';
import type { OrderIntakeOverrides } from '../../../../lib/orders/bigcommerceOrderTypes';
import { buildApiRequestContext, runWithRequestContext } from '../../../../lib/requestContext';
import { assertProductPlatformRequestAuthorized } from '../../../../lib/storefront/productPlatformAuth';

interface OrderIntakeRequestBody {
  orderId?: number;
  source?: OrderIntakeSource;
  autoSubmit?: boolean;
  overrides?: OrderIntakeOverrides;
  metadata?: Record<string, unknown>;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`Invalid ${fieldName}.`);
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return parsed;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(
    buildApiRequestContext(req, {
      source: 'storefront-order-intake',
    }),
    async () => {
      logger.info('storefront order intake request received', {
        method: req.method,
      });

      try {
        if (req.method !== 'POST') {
          res.setHeader('Allow', ['POST']);
          return res.status(405).json({ message: `Method ${req.method} not allowed` });
        }

        assertProductPlatformRequestAuthorized(req);

        const body = (req.body ?? {}) as OrderIntakeRequestBody;
        const orderId = parsePositiveInteger(body.orderId, 'orderId');
        const result = await intakeBigCommerceOrder({
          orderId,
          source: body.source ?? 'MERCHMONK_CHECKOUT',
          autoSubmit: body.autoSubmit ?? true,
          overrides: body.overrides,
          metadata: body.metadata,
        });

        res.setHeader('Cache-Control', 'no-store');
        return res.status(202).json(result);
      } catch (error: unknown) {
        const statusCode =
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof (error as { statusCode?: unknown }).statusCode === 'number'
            ? (error as { statusCode: number }).statusCode
            : 500;

        await recordInternalFailure({
          action: 'storefront_order_intake_request',
          payload: {
            method: req.method ?? 'UNKNOWN',
            url: req.url ?? '',
            body: typeof req.body === 'object' ? req.body : {},
          },
          error,
        });

        logger.error('storefront order intake request failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          statusCode,
        });

        return res.status(statusCode).json({
          message: error instanceof Error ? error.message : 'Failed to intake BigCommerce order.',
        });
      }
    },
  );
}
