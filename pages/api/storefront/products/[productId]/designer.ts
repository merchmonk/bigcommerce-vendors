import type { NextApiRequest, NextApiResponse } from 'next';
import { getSystemSessionContext } from '../../../../../lib/auth';
import { recordInternalFailure } from '../../../../../lib/apiTelemetry';
import logger from '../../../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../../../lib/requestContext';
import { getProductDesignerPayload } from '../../../../../lib/storefront/productDesignerBff';
import { assertProductPlatformRequestAuthorized } from '../../../../../lib/storefront/productPlatformAuth';

function parsePositiveInteger(value: string | string[] | undefined, fieldName: string): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
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
      source: 'storefront-bff',
    }),
    async () => {
      logger.info('storefront designer request received', {
        method: req.method,
        productId: req.query.productId,
        variantId: req.query.variantId,
        quantity: req.query.quantity,
      });

      try {
        if (req.method !== 'GET') {
          res.setHeader('Allow', ['GET']);
          res.status(405).end(`Method ${req.method} Not Allowed`);
          return;
        }

        assertProductPlatformRequestAuthorized(req);

        const productId = parsePositiveInteger(req.query.productId, 'productId');
        const variantId = parsePositiveInteger(req.query.variantId, 'variantId');
        const quantity = parsePositiveInteger(req.query.quantity ?? '1', 'quantity');
        const session = await getSystemSessionContext();

        const payload = await getProductDesignerPayload({
          accessToken: session.accessToken,
          storeHash: session.storeHash,
          productId,
          variantId,
          quantity,
        });

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(payload);
      } catch (error: unknown) {
        const statusCode =
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof (error as { statusCode?: unknown }).statusCode === 'number'
            ? (error as { statusCode: number }).statusCode
            : undefined;

        await recordInternalFailure({
          action: 'storefront_product_designer_request',
          payload: {
            method: req.method ?? 'UNKNOWN',
            url: req.url ?? '',
            query: {
              productId: req.query.productId,
              variantId: req.query.variantId,
              quantity: req.query.quantity,
            },
          },
          error,
        });

        logger.error('storefront designer request failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
          statusCode: statusCode ?? 500,
        });

        res.status(statusCode ?? 500).json({
          message: error instanceof Error ? error.message : 'Failed to build product designer payload.',
        });
      }
    },
  );
}
