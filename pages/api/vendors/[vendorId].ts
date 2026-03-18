import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { applyVendorMappingDrafts, resolveMappingDrafts } from '../../../lib/etl/mappingDrafts';
import { seedPromoStandardsMappings } from '../../../lib/etl/promostandardsSeed';
import { listEnabledVendorEndpointMappings } from '../../../lib/etl/repository';
import logger from '../../../lib/logger';
import {
  deactivateVendor,
  deleteVendor,
  getVendorById,
  type VendorInput,
  updateVendor,
} from '../../../lib/vendors';
import type { EndpointMappingDraft } from '../../../types';

interface UpdateVendorBody extends Partial<VendorInput> {
  endpoint_mappings?: EndpointMappingDraft[];
}

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
        const assignedMappings = await listEnabledVendorEndpointMappings(vendorId);
        res.status(200).json({
          ...vendor,
          endpoint_mappings: assignedMappings.map(item => ({
            mapping_id: item.mapping_id,
            enabled: item.is_enabled,
            endpoint_name: item.mapping.endpoint_name,
            endpoint_version: item.mapping.endpoint_version,
            operation_name: item.mapping.operation_name,
            protocol: item.mapping.protocol,
            payload_format: item.mapping.payload_format,
            is_product_endpoint: item.mapping.is_product_endpoint,
            structure_input:
              item.mapping.payload_format === 'XML'
                ? item.mapping.structure_xml ?? ''
                : JSON.stringify(item.mapping.structure_json ?? {}, null, 2),
            runtime_config: item.runtime_config ?? {},
            transform_schema: item.mapping.transform_schema ?? {},
            metadata: item.mapping.metadata ?? {},
          })),
        });
        break;
      }
      case 'PUT': {
        const body = req.body as UpdateVendorBody;

        if (body.is_active === false) {
          await deactivateVendor(vendorId);
          logger.info('vendor deactivated', { vendorId });
          const vendor = await getVendorById(vendorId);
          res.status(200).json(vendor);
          return;
        }

        const existingVendor = await getVendorById(vendorId);
        if (!existingVendor) {
          res.status(404).json({ message: 'Vendor not found' });
          return;
        }

        const integrationFamily = body.integration_family ?? existingVendor.integration_family;
        const defaultProtocol = body.api_protocol ?? existingVendor.api_protocol ?? 'SOAP';

        if (integrationFamily === 'PROMOSTANDARDS') {
          await seedPromoStandardsMappings();
        }

        const updated = await updateVendor(vendorId, {
          vendor_name: body.vendor_name,
          vendor_api_url: body.vendor_api_url,
          vendor_account_id: body.vendor_account_id,
          vendor_secret: body.vendor_secret,
          integration_family: integrationFamily,
          api_protocol: defaultProtocol,
          connection_config: body.connection_config,
          is_active: body.is_active,
        });
        if (!updated) {
          res.status(404).json({ message: 'Vendor not found' });
          return;
        }

        if (Array.isArray(body.endpoint_mappings)) {
          const resolvedDrafts = await resolveMappingDrafts({
            integrationFamily,
            defaultProtocol,
            drafts: body.endpoint_mappings,
          });
          if (resolvedDrafts.length === 0) {
            return res.status(400).json({ message: 'At least one enabled endpoint mapping is required.' });
          }
          await applyVendorMappingDrafts(vendorId, resolvedDrafts);
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
