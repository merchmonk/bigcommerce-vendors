import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextApiRequest } from 'next';

export interface RequestContext {
  correlationId: string;
  requestId?: string;
  vendorId?: number;
  integrationJobId?: number;
  orderIntegrationStateId?: number;
  syncRunId?: number;
  method?: string;
  path?: string;
  source?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => Promise<T> | T,
): Promise<T> | T {
  return requestContextStorage.run(context, callback);
}

export function mergeRequestContext(patch: Partial<RequestContext>): RequestContext {
  const existing = getRequestContext();
  const nextContext: RequestContext = {
    correlationId: patch.correlationId ?? existing?.correlationId ?? randomUUID(),
    requestId: patch.requestId ?? existing?.requestId,
    vendorId: patch.vendorId ?? existing?.vendorId,
    integrationJobId: patch.integrationJobId ?? existing?.integrationJobId,
    orderIntegrationStateId: patch.orderIntegrationStateId ?? existing?.orderIntegrationStateId,
    syncRunId: patch.syncRunId ?? existing?.syncRunId,
    method: patch.method ?? existing?.method,
    path: patch.path ?? existing?.path,
    source: patch.source ?? existing?.source,
  };
  requestContextStorage.enterWith(nextContext);
  return nextContext;
}

export function buildApiRequestContext(
  req: NextApiRequest,
  patch?: Partial<RequestContext>,
): RequestContext {
  const correlationHeader = req.headers['x-correlation-id'];
  const requestHeader = req.headers['x-request-id'];
  const correlationId =
    (Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader) ??
    (Array.isArray(requestHeader) ? requestHeader[0] : requestHeader) ??
    randomUUID();
  const requestId = Array.isArray(requestHeader) ? requestHeader[0] : requestHeader;

  return {
    correlationId,
    requestId,
    method: req.method,
    path: req.url,
    source: 'api',
    ...patch,
  };
}
