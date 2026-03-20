import type { NextApiRequest, NextApiResponse } from 'next';
import logger from '../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../lib/requestContext';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), () => {
    logger.info('health API request');
    res.status(200).json({ ok: true });
  });
}
