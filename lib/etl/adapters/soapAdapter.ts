import { callSoapEndpoint } from '../soapClient';
import type { EndpointAdapter } from './types';

export const soapAdapter: EndpointAdapter = {
  protocol: 'SOAP',
  async testConnection(input) {
    const operationName = input.operationName ?? 'getCompanyData';
    const endpointVersion = input.endpointVersion ?? '1.0.0';
    const result = await callSoapEndpoint({
      endpointUrl: input.endpointUrl,
      endpointUrlIsFinal: true,
      endpointName: input.endpointName ?? 'CompanyData',
      operationName,
      endpointVersion,
      vendorAccountId: input.vendorAccountId,
      vendorSecret: input.vendorSecret,
      soapAction: input.runtimeConfig?.soap_action as string | undefined,
      requestTemplate: input.runtimeConfig?.request_template as string | undefined,
      requestFields: input.runtimeConfig?.request_fields as Record<string, unknown> | undefined,
    });

    if (result.status >= 400 || !result.parsedBody) {
      throw new Error(`SOAP connection failed (${result.status})`);
    }

    return {
      ok: true,
      message: 'Connection successful.',
    };
  },
  async invokeEndpoint(input) {
    const result = await callSoapEndpoint({
      endpointUrl: input.endpointUrl,
      endpointUrlIsFinal: true,
      endpointName: input.endpointName,
      operationName: input.operationName,
      endpointVersion: input.endpointVersion,
      vendorAccountId: input.vendorAccountId,
      vendorSecret: input.vendorSecret,
      soapAction: input.runtimeConfig?.soap_action as string | undefined,
      requestTemplate: input.runtimeConfig?.request_template as string | undefined,
      requestFields: input.runtimeConfig?.request_fields as Record<string, unknown> | undefined,
    });

    return {
      status: result.status,
      rawPayload: result.rawXml,
      parsedBody: result.parsedBody,
    };
  },
};
