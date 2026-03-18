import type { MappingProtocol } from '../../../types';

export interface AdapterTestConnectionInput {
  endpointUrl: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  operationName?: string;
  endpointVersion?: string;
  runtimeConfig?: Record<string, unknown>;
}

export interface AdapterInvokeInput {
  endpointUrl: string;
  operationName: string;
  endpointVersion: string;
  vendorAccountId?: string | null;
  vendorSecret?: string | null;
  runtimeConfig?: Record<string, unknown>;
}

export interface AdapterInvokeResult {
  status: number;
  rawPayload: string;
  parsedBody: Record<string, unknown> | null;
}

export interface EndpointAdapter {
  protocol: MappingProtocol;
  testConnection(input: AdapterTestConnectionInput): Promise<{ ok: boolean; message: string }>;
  invokeEndpoint(input: AdapterInvokeInput): Promise<AdapterInvokeResult>;
}
