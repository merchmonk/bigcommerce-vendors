import { NextApiRequest, NextApiResponse } from 'next';
import { encodePayload, getBCAuth, setSession } from '../../lib/auth';
import logger from '../../lib/logger';

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
    logger.info('auth API request');
    try {
        // Authenticate the app on install
        const session = await getBCAuth(req.query);
        const encodedContext = encodePayload(session); // Signed JWT to validate/ prevent tampering

        await setSession(session);
        logger.info('auth success');
        res.redirect(302, `/?context=${encodedContext}`);
    } catch (error: any) {
        logger.error('auth API error', {
            message: error?.message,
            stack: error?.stack,
            status: error?.response?.status,
        });
        const { message, response } = error;
        res.status(response?.status || 500).json({ message });
    }
}
