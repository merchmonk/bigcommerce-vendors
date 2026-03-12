import { NextApiRequest, NextApiResponse } from 'next';
import { encodePayload, getBCVerify, setSession } from '../../lib/auth';
import logger from '../../lib/logger';

const buildRedirectUrl = (url: string, encodedContext: string) => {
    const [path, query = ''] = url.split('?');
    const queryParams = new URLSearchParams(`context=${encodedContext}&${query}`);

    return `${path}?${queryParams}`;
}

export default async function load(req: NextApiRequest, res: NextApiResponse) {
    logger.info('load API request');
    try {
        // Verify when app loaded (launch)
        const session = await getBCVerify(req.query);
        const encodedContext = encodePayload(session); // Signed JWT to validate/ prevent tampering

        await setSession(session);
        logger.info('load success', { url: session?.url });
        res.redirect(302, buildRedirectUrl(session.url, encodedContext));
    } catch (error: any) {
        logger.error('load API error', {
            message: error?.message,
            stack: error?.stack,
            status: error?.response?.status,
        });
        const { message, response } = error;
        res.status(response?.status || 500).json({ message });
    }
}
