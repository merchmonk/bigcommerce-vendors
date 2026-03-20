import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { testVendorConnectionConfig } from '../../../lib/etl/runner';
import { discoverPromostandardsCapabilities } from '../../../lib/vendors/promostandardsDiscovery';
import type { IntegrationFamily, MappingProtocol } from '../../../types';

interface TestConnectionBody {
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  integration_family?: IntegrationFamily;
  api_protocol?: MappingProtocol;
  operation_name?: string;
  endpoint_version?: string;
  runtime_config?: Record<string, unknown>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  return runWithRequestContext(buildApiRequestContext(req), async () => {
    logger.info('vendor test-connection API request', { method: req.method });
    try {
      await getSession(req);
      if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} not allowed` });
      }

      const body = req.body as TestConnectionBody;
      if (!body.vendor_api_url) {
        return res.status(400).json({ ok: false, message: 'vendor_api_url is required' });
      }

      if ((body.integration_family ?? 'CUSTOM') === 'PROMOSTANDARDS') {
        const result = await discoverPromostandardsCapabilities({
          vendor_api_url: body.vendor_api_url,
          vendor_account_id: body.vendor_account_id ?? null,
          vendor_secret: body.vendor_secret ?? null,
          api_protocol: body.api_protocol ?? 'SOAP',
        });

        return res.status(result.ok ? 200 : 400).json(result);
      }

      const result = await testVendorConnectionConfig({
        vendorApiUrl: body.vendor_api_url,
        vendorAccountId: body.vendor_account_id ?? null,
        vendorSecret: body.vendor_secret ?? null,
        apiProtocol: body.api_protocol ?? 'SOAP',
        operationName: body.operation_name,
        endpointVersion: body.endpoint_version,
        runtimeConfig: body.runtime_config ?? {},
      });

      return res.status(200).json(result);
    } catch (error: any) {
      await recordInternalFailure({
        action: 'vendor_test_connection_api_request',
        payload: {
          method: req.method ?? 'UNKNOWN',
          url: req.url ?? '',
          body: typeof req.body === 'object' ? req.body : {},
        },
        error,
      });
      const { message, response } = error;
      return res.status(response?.status || 500).json({
        ok: false,
        message: message ?? 'Vendor test connection failed',
      });
    }
  });
}
