import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import { recordInternalFailure } from '../../../lib/apiTelemetry';
import logger from '../../../lib/logger';
import { buildApiRequestContext, runWithRequestContext } from '../../../lib/requestContext';
import { testVendorConnectionConfig } from '../../../lib/etl/runner';
import {
  discoverPromostandardsEndpointsFromCompanyData,
  testPromostandardsEndpointUrls,
} from '../../../lib/vendors/promostandardsDiscovery';
import type { IntegrationFamily, MappingProtocol, PromostandardsEndpointCapability } from '../../../types';

interface TestConnectionBody {
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  integration_family?: IntegrationFamily;
  api_protocol?: MappingProtocol;
  hasCompanyDataEndpoint?: boolean;
  companyDataEndpointUrl?: string;
  promostandardsEndpoints?: PromostandardsEndpointCapability[];
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
      if ((body.integration_family ?? 'CUSTOM') === 'PROMOSTANDARDS') {
        if (body.hasCompanyDataEndpoint) {
          if (!body.companyDataEndpointUrl?.trim()) {
            return res.status(400).json({ ok: false, message: 'companyDataEndpointUrl is required' });
          }

          const result = await discoverPromostandardsEndpointsFromCompanyData({
            companyDataEndpointUrl: body.companyDataEndpointUrl.trim(),
            vendorAccountId: body.vendor_account_id ?? null,
            vendorSecret: body.vendor_secret ?? null,
            protocol: body.api_protocol ?? 'SOAP',
          });

          return res.status(result.ok ? 200 : 400).json({
            ok: result.ok,
            message: result.message,
            availableEndpointCount: result.availableEndpointCount,
            credentialsValid: result.credentialsValid,
            endpointMappingIds: result.endpointMappingIds,
            fingerprint: result.fingerprint,
            testedAt: result.testedAt,
            endpoints: result.endpoints,
          });
        }

        const result = await testPromostandardsEndpointUrls({
          vendorAccountId: body.vendor_account_id ?? null,
          vendorSecret: body.vendor_secret ?? null,
          protocol: body.api_protocol ?? 'SOAP',
          endpoints: body.promostandardsEndpoints?.map(endpoint => ({
            endpointName: endpoint.endpointName,
            endpointUrl: endpoint.endpointUrl,
            endpointVersion: endpoint.endpointVersion ?? null,
          })) ?? [],
        });

        return res.status(result.ok ? 200 : 400).json(result);
      }

      if (!body.vendor_api_url) {
        return res.status(400).json({ ok: false, message: 'vendor_api_url is required' });
      }

      const result = await testVendorConnectionConfig({
        vendorApiUrl: body.vendor_api_url,
        vendorAccountId: body.vendor_account_id ?? null,
        vendorSecret: body.vendor_secret ?? null,
        apiProtocol: body.api_protocol ?? 'SOAP',
        operationName: undefined,
        endpointVersion: undefined,
        runtimeConfig: {},
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
