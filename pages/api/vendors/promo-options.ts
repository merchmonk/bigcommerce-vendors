import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import logger from '../../../lib/logger';
import { seedPromoStandardsMappings } from '../../../lib/etl/promostandardsSeed';
import { listEndpointMappings } from '../../../lib/etl/repository';
import type { MappingStandardType } from '../../../types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  logger.info('vendor mapping options API request');
  try {
    await getSession(req);
    if (req.query.seed === '1' || req.query.seed === 'true') {
      await seedPromoStandardsMappings();
    }

    const standardType = ((req.query.standard_type as string | undefined) ?? 'PROMOSTANDARDS') as MappingStandardType;
    const mappings = await listEndpointMappings({ standard_type: standardType });
    const versionsByEndpoint = mappings.reduce<Record<string, string[]>>((acc, mapping) => {
      if (!acc[mapping.endpoint_name]) {
        acc[mapping.endpoint_name] = [];
      }
      if (!acc[mapping.endpoint_name].includes(mapping.endpoint_version)) {
        acc[mapping.endpoint_name].push(mapping.endpoint_version);
      }
      return acc;
    }, {});
    const endpoints = Object.keys(versionsByEndpoint).sort();

    endpoints.forEach(endpoint => {
      versionsByEndpoint[endpoint].sort();
    });

    res.status(200).json({
      endpoints,
      versionsByEndpoint,
      mappings,
    });
  } catch (error: any) {
    logger.error('vendor mapping options API error', {
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    res.status(response?.status || 500).json({ message: message ?? 'Failed to load mapping options' });
  }
}
