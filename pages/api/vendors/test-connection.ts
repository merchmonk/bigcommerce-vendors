import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '../../../lib/auth';
import logger from '../../../lib/logger';
import { testVendorConnectionConfig } from '../../../lib/etl/runner';
import type { MappingProtocol } from '../../../types';

interface TestConnectionBody {
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  api_protocol?: MappingProtocol;
  operation_name?: string;
  endpoint_version?: string;
  runtime_config?: Record<string, unknown>;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    logger.error('vendor test-connection API error', {
      message: error?.message,
      stack: error?.stack,
      status: error?.response?.status,
    });
    const { message, response } = error;
    return res.status(response?.status || 500).json({
      ok: false,
      message: message ?? 'Vendor test connection failed',
    });
  }
}
