import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { listEndpointMappings } from '../../../lib/etl/repository';
import type { MappingStandardType } from '../../../types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('vendor mapping options API request');
    try {
      await getSession(req);

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
      await recordInternalFailure({
        action: 'vendor_mapping_options_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          query: req.query,
        },
        error,
      });
      const { message, response } = error;
      res.status(response?.status || 500).json({ message: message ?? 'Failed to load mapping options' });
    }
  });
}
