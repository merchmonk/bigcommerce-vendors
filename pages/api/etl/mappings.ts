import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import logger from '../../../lib/logger';
import type { MappingProtocol, MappingStandardType } from '../../../types';
import { seedPromoStandardsMappings } from '../../../lib/etl/promostandardsSeed';
import {
  listEndpointMappings,
  type EndpointMappingUpsertInput,
  upsertEndpointMappings,
} from '../../../lib/etl/repository';

interface UpsertMappingsRequestBody {
  seed_promostandards?: boolean;
  mappings?: EndpointMappingUpsertInput[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  logger.info('etl mappings API request', { method: req.method });
  try {
    await getSession(req);

    if (req.method === 'GET') {
      if (req.query.seed === '1' || req.query.seed === 'true') {
        await seedPromoStandardsMappings();
      }

      const standardType = (req.query.standard_type as MappingStandardType | undefined) ?? undefined;
      const protocol = (req.query.protocol as MappingProtocol | undefined) ?? undefined;
      const mappings = await listEndpointMappings({
        standard_type: standardType,
        protocol,
      });
      return res.status(200).json({ data: mappings });
    }

    if (req.method === 'POST') {
      const body = req.body as UpsertMappingsRequestBody;
      if (body.seed_promostandards) {
        await seedPromoStandardsMappings();
      }

      const mappings = Array.isArray(body.mappings) ? body.mappings : [];
      if (mappings.length === 0) {
        return res.status(200).json({ data: [] });
      }

      const upserted = await upsertEndpointMappings(mappings);
      return res.status(200).json({ data: upserted });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ message: `Method ${req.method} not allowed` });
  } catch (error: any) {
    logger.error('etl mappings API error', {
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    return res.status(response?.status || 500).json({ message: message ?? 'ETL mappings API error' });
  }
}
