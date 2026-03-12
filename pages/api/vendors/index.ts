import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import logger from '../../../lib/logger';
import { createVendor, listVendors, VendorInput } from '../../../lib/vendors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  logger.info('vendors API request', { method: req.method });
  try {
    await getSession(req);

    switch (req.method) {
      case 'GET': {
        const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
        const vendors = await listVendors(includeInactive);
        logger.info('vendors list', { count: vendors.length });
        res.status(200).json({ data: vendors });
        break;
      }
      case 'POST': {
        const body = req.body as VendorInput;
        const vendor = await createVendor(body);
        logger.info('vendor created', { vendorId: vendor.id });
        res.status(201).json(vendor);
        break;
      }
      default: {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
      }
    }
  } catch (error: any) {
    logger.error('vendors API error', {
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    res.status(response?.status || 500).json({ message: message ?? 'Vendor API error' });
  }
}

