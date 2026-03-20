import { NextApiRequest, NextApiResponse } from 'next';
import { getBCVerify, removeUserData } from '../../lib/auth';
import { recordInternalFailure } from '../../lib/apiTelemetry';
import logger from '../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../lib/requestContext';

export default async function removeUser(req: NextApiRequest, res: NextApiResponse) {
    return runWithRequestContext(buildApiRequestContext(req), async () => {
        logger.info('removeUser API request');
        try {
            const session = await getBCVerify(req.query);

            await removeUserData(session);
            res.status(200).end();
        } catch (error) {
            await recordInternalFailure({
                action: 'remove_user_api_request',
                payload: {
                    method: req.method ?? 'UNKNOWN',
                    url: req.url ?? '',
                    query: req.query,
                },
                error,
            });
            const { message, response } = error as { message?: string; response?: { status?: number } };
            res.status(response?.status || 500).json({ message });
        }
    });
}
