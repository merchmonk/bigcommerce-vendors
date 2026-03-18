import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { applyVendorMappingDrafts, resolveMappingDrafts } from '../../../lib/etl/mappingDrafts';
import { seedPromoStandardsMappings } from '../../../lib/etl/promostandardsSeed';
import { runVendorSync } from '../../../lib/etl/runner';
import logger from '../../../lib/logger';
import { createVendor, listVendors, type VendorInput } from '../../../lib/vendors';
import type { EndpointMappingDraft } from '../../../types';

interface CreateVendorRequestBody extends VendorInput {
  connection_tested?: boolean;
  auto_sync?: boolean;
  endpoint_mappings?: EndpointMappingDraft[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  logger.info('vendors API request', { method: req.method });
  try {
    const session = await getSession(req);

    switch (req.method) {
      case 'GET': {
        const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
        const vendors = await listVendors(includeInactive);
        logger.info('vendors list', { count: vendors.length });
        res.status(200).json({ data: vendors });
        break;
      }
      case 'POST': {
        const body = req.body as CreateVendorRequestBody;
        const integrationFamily = body.integration_family ?? 'CUSTOM';
        const defaultProtocol = body.api_protocol ?? 'SOAP';

        if (integrationFamily === 'PROMOSTANDARDS') {
          if (!body.connection_tested) {
            return res.status(400).json({
              message: 'Vendor connection must be tested successfully before creating a PromoStandards vendor.',
            });
          }
          await seedPromoStandardsMappings();
        }

        const resolvedDrafts = await resolveMappingDrafts({
          integrationFamily,
          defaultProtocol,
          drafts: body.endpoint_mappings ?? [],
        });
        if (resolvedDrafts.length === 0) {
          return res.status(400).json({ message: 'At least one enabled endpoint mapping is required.' });
        }

        const vendor = await createVendor({
          vendor_name: body.vendor_name,
          vendor_api_url: body.vendor_api_url,
          vendor_account_id: body.vendor_account_id,
          vendor_secret: body.vendor_secret,
          integration_family: integrationFamily,
          api_protocol: defaultProtocol,
          connection_config: body.connection_config ?? {},
          is_active: body.is_active,
        });

        await applyVendorMappingDrafts(vendor.vendor_id, resolvedDrafts);

        if (integrationFamily === 'PROMOSTANDARDS' && (body.auto_sync ?? true) && session) {
          try {
            await runVendorSync({
              vendorId: vendor.vendor_id,
              session,
              syncAll: true,
            });
          } catch (syncError: any) {
            logger.error('vendor initial sync error', {
              vendorId: vendor.vendor_id,
              message: syncError?.message,
              stack: syncError?.stack,
            });
          }
        }
        logger.info('vendor created', { vendorId: vendor?.vendor_id });
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
