import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../lib/auth';
import logger from '../../../../lib/logger';
import { runVendorSync } from '../../../../lib/etl/runner';
import { listSyncRunsForVendor } from '../../../../lib/etl/repository';

interface RunSyncBody {
  mapping_id?: number;
  sync_all?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  logger.info('vendor sync API request', { method: req.method, vendorId });

  try {
    const session = await getSession(req);
    if (!session) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!Number.isFinite(vendorId)) {
      return res.status(400).json({ message: 'Invalid vendorId' });
    }

    if (req.method === 'GET') {
      const runs = await listSyncRunsForVendor(vendorId);
      return res.status(200).json({ data: runs });
    }

    if (req.method === 'POST') {
      const body = req.body as RunSyncBody;
      const result = await runVendorSync({
        vendorId,
        session,
        mappingId: body.mapping_id,
        syncAll: body.sync_all,
      });
      return res.status(200).json({ data: result });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ message: `Method ${req.method} not allowed` });
  } catch (error: any) {
    logger.error('vendor sync API error', {
      vendorId,
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    return res.status(response?.status || 500).json({ message: message ?? 'Vendor sync failed' });
  }
}
