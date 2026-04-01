import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../../lib/auth';
import { recordInternalFailure } from '../../../../lib/apiTelemetry';
import { applyVendorMappingDrafts, resolveMappingDrafts } from '../../../../lib/etl/mappingDrafts';
import {
  listEndpointMappingsByIds,
  listVendorEndpointMappings,
  replaceVendorEndpointMappings,
} from '../../../../lib/etl/repository';
import logger from '../../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../../lib/requestContext';
import { getVendorById } from '../../../../lib/vendors';
import type { EndpointMappingDraft } from '../../../../types';

interface UpdateVendorMappingsBody {
  mapping_ids?: number[];
  endpoint_mappings?: EndpointMappingDraft[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  return runWithRequestContext(buildApiRequestContext(req, { vendorId }), async () => {
    logger.info('vendor mappings API request', { method: req.method, vendorId });

    try {
      await getSession(req);
      if (!Number.isFinite(vendorId)) {
        return res.status(400).json({ message: 'Invalid vendorId' });
      }

      if (req.method === 'GET') {
        const vendorMappings = await listVendorEndpointMappings(vendorId);
        const mappingIds = vendorMappings.map(item => item.endpoint_mapping_id);
        const mappings = await listEndpointMappingsByIds(mappingIds);
        const mappingById = new Map(mappings.map(mapping => [mapping.endpoint_mapping_id, mapping]));
        const data = vendorMappings.map(vendorMapping => ({
          ...vendorMapping,
          mapping: mappingById.get(vendorMapping.endpoint_mapping_id) ?? null,
        }));
        return res.status(200).json({ data });
      }

      if (req.method === 'PUT') {
        const body = req.body as UpdateVendorMappingsBody;
        if (Array.isArray(body.endpoint_mappings)) {
          const vendor = await getVendorById(vendorId);
          if (!vendor) {
            return res.status(404).json({ message: 'Vendor not found' });
          }
          const resolved = await resolveMappingDrafts({
            integrationFamily: vendor.integration_family,
            defaultProtocol: vendor.api_protocol ?? 'SOAP',
            drafts: body.endpoint_mappings,
          });
          await applyVendorMappingDrafts(vendorId, resolved);
          const refreshed = await listVendorEndpointMappings(vendorId);
          return res.status(200).json({ data: refreshed });
        }

        const mappingIds = Array.isArray(body?.mapping_ids)
          ? body.mapping_ids.filter(id => Number.isFinite(id)).map(id => Number(id))
          : [];

        const updated = await replaceVendorEndpointMappings(vendorId, mappingIds);
        return res.status(200).json({ data: updated });
      }

      res.setHeader('Allow', ['GET', 'PUT']);
      return res.status(405).json({ message: `Method ${req.method} not allowed` });
    } catch (error: any) {
      await recordInternalFailure({
        action: 'vendor_mappings_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          vendor_id: vendorId,
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response } = error;
      return res.status(response?.status || 500).json({ message: message ?? 'Vendor mappings API error' });
    }
  });
}
