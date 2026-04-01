import type { NextApiRequest, NextApiResponse } from 'next';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import { getSession } from '../../../lib/auth';
import { listEnabledVendorEndpointMappings } from '../../../lib/etl/repository';
import { submitCatalogSyncJob } from '../../../lib/integrationJobs';
import logger from '../../../lib/logger';
import { buildApiRequestContext, getRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { listVendors } from '../../../lib/vendors';

interface InventorySyncResult {
  vendor_id: number;
  vendor_name: string;
  endpoint_mapping_id: number | null;
  job: Awaited<ReturnType<typeof submitCatalogSyncJob>>['job'] | null;
  deduplicated: boolean;
  skipped_reason?: string;
}

function findInventoryMappingId(
  mappings: Array<{
    endpoint_mapping_id: number;
    mapping: {
      endpoint_name: string;
    };
  }>,
): number | null {
  const inventoryMapping = mappings.find(item => item.mapping.endpoint_name === 'Inventory');
  return inventoryMapping?.endpoint_mapping_id ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('inventory sync API request', { method: req.method });

    try {
      const session = await getSession(req);
      if (!session) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} not allowed` });
      }

      const vendors = await listVendors(false);
      const results: InventorySyncResult[] = [];

      for (const vendor of vendors) {
        const mappings = await listEnabledVendorEndpointMappings(vendor.vendor_id);
        const inventoryMappingId = findInventoryMappingId(mappings);

        if (!inventoryMappingId) {
          results.push({
            vendor_id: vendor.vendor_id,
            vendor_name: vendor.vendor_name,
            endpoint_mapping_id: null,
            job: null,
            deduplicated: false,
            skipped_reason: 'No enabled Inventory mapping found for this vendor.',
          });
          continue;
        }

        const submitted = await submitCatalogSyncJob({
          vendorId: vendor.vendor_id,
          mappingId: inventoryMappingId,
          sourceAction: 'manual_inventory_sync',
          correlationId: getRequestContext()?.correlationId ?? 'unknown',
          requestPayload: {
            inventory_only: true,
            endpoint_mapping_id: inventoryMappingId,
          },
        });

        results.push({
          vendor_id: vendor.vendor_id,
          vendor_name: vendor.vendor_name,
          endpoint_mapping_id: inventoryMappingId,
          job: submitted.job,
          deduplicated: submitted.deduplicated,
        });
      }

      return res.status(202).json({
        data: results,
        summary: {
          active_vendor_count: vendors.length,
          submitted_count: results.filter(result => result.job).length,
          deduplicated_count: results.filter(result => result.deduplicated).length,
          skipped_count: results.filter(result => result.skipped_reason).length,
        },
      });
    } catch (error: any) {
      await recordInternalFailure({
        action: 'inventory_sync_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response } = error;
      return res.status(response?.status || 500).json({ message: message ?? 'Inventory sync failed' });
    }
  });
}
