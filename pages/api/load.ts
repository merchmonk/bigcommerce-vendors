import { NextApiRequest, NextApiResponse } from 'next';
import { encodePayload, getBCVerify, setSession } from '../../lib/auth';
import { recordInternalFailure } from '../../lib/apiTelemetry';
import logger from '../../lib/logger';
import { ensureBigCommerceOrderWebhooks } from '../../lib/orders/bigcommerceOrderWebhooks';
import { buildApiRequestContext, runWithRequestContext } from '../../lib/requestContext';

const buildRedirectUrl = (url: string, encodedContext: string) => {
    const [path, query = ''] = url.split('?');
    const queryParams = new URLSearchParams(`context=${encodedContext}&${query}`);

    return `${path}?${queryParams}`;
}

export default async function load(req: NextApiRequest, res: NextApiResponse) {
    return runWithRequestContext(buildApiRequestContext(req), async () => {
        logger.info('load API request');
        try {
            const session = await getBCVerify(req.query);
            const encodedContext = encodePayload(session);

            await setSession(session);
            const accessToken = session.access_token?.trim();
            if (accessToken) {
                try {
                    await ensureBigCommerceOrderWebhooks({
                        accessToken,
                        storeHash: (session.context ?? session.sub ?? '').split('/')[1] ?? '',
                        headers: req.headers,
                    });
                } catch (webhookError) {
                    logger.warn('failed to ensure BigCommerce order webhooks on load', {
                        error: webhookError instanceof Error ? webhookError.message : 'Unknown error',
                    });
                }
            }
            logger.info('load success', { url: session?.url });
            res.redirect(302, buildRedirectUrl(session.url, encodedContext));
        } catch (error: any) {
            await recordInternalFailure({
                action: 'load_api_request',
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
