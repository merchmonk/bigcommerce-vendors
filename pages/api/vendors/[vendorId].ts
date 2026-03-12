import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import logger from '../../../lib/logger';
import { deactivateVendor, deleteVendor, getVendorById, updateVendor, VendorInput } from '../../../lib/vendors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  logger.info('vendor by id API request', { method: req.method, vendorId });
  try {
    await getSession(req);

    if (!Number.isFinite(vendorId)) {
      res.status(400).json({ message: 'Invalid vendorId' });
      return;
    }

    switch (req.method) {
      case 'GET': {
        const vendor = await getVendorById(vendorId);
        if (!vendor) {
          res.status(404).json({ message: 'Vendor not found' });
          return;
        }
        res.status(200).json(vendor);
        break;
      }
      case 'PUT': {
        const body = req.body as Partial<VendorInput>;

        // If the request explicitly sets is_active to false, treat as deactivate.
        if (body.is_active === false) {
          await deactivateVendor(vendorId);
          logger.info('vendor deactivated', { vendorId });
          const vendor = await getVendorById(vendorId);
          res.status(200).json(vendor);
          return;
        }

        const updated = await updateVendor(vendorId, body);
        if (!updated) {
          res.status(404).json({ message: 'Vendor not found' });
          return;
        }
        logger.info('vendor updated', { vendorId });
        res.status(200).json(updated);
        break;
      }
      case 'DELETE': {
        await deleteVendor(vendorId);
        logger.info('vendor deleted', { vendorId });
        res.status(204).end();
        break;
      }
      default: {
        res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
      }
    }
  } catch (error: any) {
    logger.error('vendor by id API error', {
      vendorId,
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    res.status(response?.status || 500).json({ message: message ?? 'Vendor API error' });
  }
}

