import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import logger from '../../../lib/logger';
import { getPromoOptions } from '../../../lib/promostandards';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  logger.info('promo-options API request');
  try {
    await getSession(req);
    const options = getPromoOptions();
    res.status(200).json(options);
  } catch (error: any) {
    logger.error('promo-options API error', {
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    res.status(response?.status || 500).json({ message: message ?? 'Failed to load PromoStandards options' });
  }
}

