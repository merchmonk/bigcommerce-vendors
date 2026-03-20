import { NextApiRequest, NextApiResponse } from 'next';
import { getSession, logoutUser } from '../../lib/auth';
import { recordInternalFailure } from '../../lib/apiTelemetry';
import logger from '../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../lib/requestContext';

export default async function logout(req: NextApiRequest, res: NextApiResponse) {
    return runWithRequestContext(buildApiRequestContext(req), async () => {
        logger.info('logout API request');
        try {
            const session = await getSession(req);

            await logoutUser(session);
            res.status(200).end();
        } catch (error) {
            await recordInternalFailure({
                action: 'logout_api_request',
                payload: {
                    method: req.method ?? 'UNKNOWN',
                    url: req.url ?? '',
                },
                error,
            });
            const { message, response } = error as { message?: string; response?: { status?: number } };
            res.status(response?.status || 500).json({ message });
        }
    });
}
