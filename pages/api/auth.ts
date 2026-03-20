import { NextApiRequest, NextApiResponse } from 'next';
import { encodePayload, getBCAuth, setSession } from '../../lib/auth';
import { recordInternalFailure } from '../../lib/apiTelemetry';
import logger from '../../lib/logger';
import { ensureBigCommerceOrderWebhooks } from '../../lib/orders/bigcommerceOrderWebhooks';
import { buildApiRequestContext, runWithRequestContext } from '../../lib/requestContext';

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
    return runWithRequestContext(buildApiRequestContext(req), async () => {
        logger.info('auth API request');
        try {
            const session = await getBCAuth(req.query);
            const encodedContext = encodePayload(session);

            await setSession(session);
            try {
                await ensureBigCommerceOrderWebhooks({
                    accessToken: session.access_token,
                    storeHash: session.context.split('/')[1] ?? '',
                    headers: req.headers,
                });
            } catch (webhookError) {
                logger.warn('failed to ensure BigCommerce order webhooks after auth', {
                    error: webhookError instanceof Error ? webhookError.message : 'Unknown error',
                });
            }
            logger.info('auth success');
            res.redirect(302, `/?context=${encodedContext}`);
        } catch (error: any) {
            await recordInternalFailure({
                action: 'auth_api_request',
                payload: {
                    method: req.method ?? 'UNKNOWN',
                    url: req.url ?? '',
                    query: req.query,
                },
                error,
            });
            const { message, response } = error;
            res.status(response?.status || 500).json({ message });
        }
    });
}
