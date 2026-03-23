import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import { applyVendorMappingDrafts } from '../../../lib/etl/mappingDrafts';
import { listEnabledVendorEndpointMappings, replaceVendorEndpointMappings } from '../../../lib/etl/repository';
import logger from '../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import {
  deactivateVendor,
  deleteVendor,
  getVendorById,
  updateVendor,
} from '../../../lib/vendors';
import { assertVendorCanDeactivate } from '../../../lib/vendors/operatorInsights';
import {
  applyPromostandardsEndpointRuntimeOverrides,
  buildVendorConnectionConfig,
  getVendorConnectionSections,
} from '../../../lib/vendors/vendorConfig';
import { prepareVendorSubmission, type VendorSubmissionInput } from '../../../lib/vendors/vendorSubmission';

interface UpdateVendorBody extends VendorSubmissionInput {}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vendorId = Number(req.query.vendorId);
  return runWithRequestContext(buildApiRequestContext(req, { vendorId }), async () => {
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
          const sections = getVendorConnectionSections(vendor.connection_config);
          const promostandardsCapabilities = applyPromostandardsEndpointRuntimeOverrides({
            capabilities: sections.promostandards_capabilities,
            endpointMappings: assignedMappings.map(item => ({
              endpoint_name: item.mapping.endpoint_name,
              endpoint_version: item.mapping.endpoint_version,
              operation_name: item.mapping.operation_name,
              runtime_config: item.runtime_config,
            })),
          });
          const connectionConfig = buildVendorConnectionConfig({
            existingConfig: vendor.connection_config,
            integrationFamily: vendor.integration_family,
            customApiServiceType: sections.custom_api?.service_type,
            customApiFormatData: sections.custom_api?.format_data,
            promostandardsCapabilities: promostandardsCapabilities ?? null,
          });
          res.status(200).json({
            ...vendor,
            connection_config: connectionConfig,
            ...sections,
            promostandards_capabilities: promostandardsCapabilities,
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
            await assertVendorCanDeactivate(vendorId);
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

          const prepared = await prepareVendorSubmission({
            body,
            existingVendor,
          });

          const updated = await updateVendor(vendorId, {
            ...prepared.vendorInput,
          });
          if (!updated) {
            res.status(404).json({ message: 'Vendor not found' });
            return;
          }

          if (prepared.mappingAction.type === 'apply') {
            await applyVendorMappingDrafts(vendorId, prepared.mappingAction.resolvedDrafts);
          } else if (prepared.mappingAction.type === 'clear') {
            await replaceVendorEndpointMappings(vendorId, []);
          }

          logger.info('vendor updated', { vendorId });
          res.status(200).json(updated);
          break;
        }
        case 'DELETE': {
          await assertVendorCanDeactivate(vendorId);
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
      await recordInternalFailure({
        action: 'vendor_by_id_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          vendor_id: vendorId,
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response, statusCode } = error;
      res.status(response?.status || statusCode || 500).json({ message: message ?? 'Vendor API error' });
    }
  });
}
