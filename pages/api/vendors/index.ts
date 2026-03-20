import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import { applyVendorMappingDrafts } from '../../../lib/etl/mappingDrafts';
import { submitCatalogSyncJob } from '../../../lib/integrationJobs';
import logger from '../../../lib/logger';
import { buildApiRequestContext, getRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { listVendorOperatorSummaries } from '../../../lib/vendors/operatorInsights';
import { prepareVendorSubmission, type VendorSubmissionInput } from '../../../lib/vendors/vendorSubmission';
import { createVendor, listVendors } from '../../../lib/vendors';

interface CreateVendorRequestBody extends VendorSubmissionInput {
  auto_sync?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('vendors API request', { method: req.method });
    try {
      const session = await getSession(req);

      switch (req.method) {
        case 'GET': {
          const includeInactive = req.query.includeInactive === '1' || req.query.includeInactive === 'true';
          const view = typeof req.query.view === 'string' ? req.query.view : 'default';
          const vendors =
            view === 'operator'
              ? await listVendorOperatorSummaries(includeInactive)
              : await listVendors(includeInactive);
          logger.info('vendors list', { count: vendors.length });
          res.status(200).json({ data: vendors });
          return;
        }
        case 'POST': {
          const body = req.body as CreateVendorRequestBody;
          const prepared = await prepareVendorSubmission({ body });

          const vendor = await createVendor({
            ...prepared.vendorInput,
          });

          if (prepared.mappingAction.type === 'apply') {
            await applyVendorMappingDrafts(vendor.vendor_id, prepared.mappingAction.resolvedDrafts);
          }

          let submittedJob: Awaited<ReturnType<typeof submitCatalogSyncJob>> | null = null;
          if (prepared.vendorInput.integration_family === 'PROMOSTANDARDS' && (body.auto_sync ?? true) && session) {
            submittedJob = await submitCatalogSyncJob({
              vendorId: vendor.vendor_id,
              syncAll: true,
              sourceAction: 'vendor_create_auto_sync',
              correlationId: getRequestContext()?.correlationId ?? 'unknown',
              requestPayload: {
                auto_sync: body.auto_sync ?? true,
                endpoint_mapping_count:
                  prepared.mappingAction.type === 'apply' ? prepared.mappingAction.resolvedDrafts.length : 0,
              },
            });
          }

          logger.info('vendor created', {
            vendorId: vendor.vendor_id,
            integrationJobId: submittedJob?.job.integration_job_id ?? null,
          });
          res.status(201).json({
            data: vendor,
            job: submittedJob?.job ?? null,
            deduplicated: submittedJob?.deduplicated ?? false,
          });
          return;
        }
        default: {
          res.setHeader('Allow', ['GET', 'POST']);
          res.status(405).end(`Method ${req.method} Not Allowed`);
        }
      }
    } catch (error: any) {
      await recordInternalFailure({
        action: 'vendors_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response, statusCode } = error;
      res.status(response?.status || statusCode || 500).json({ message: message ?? 'Vendor API error' });
    }
  });
}
