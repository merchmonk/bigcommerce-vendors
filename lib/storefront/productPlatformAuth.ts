import type { NextApiRequest } from 'next';

function readHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function assertProductPlatformRequestAuthorized(req: NextApiRequest): void {
  const configuredToken = process.env.PRODUCT_PLATFORM_SHARED_TOKEN?.trim();

  if (!configuredToken) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('PRODUCT_PLATFORM_SHARED_TOKEN is not configured for storefront designer requests.');
    }
    return;
  }

  const authorization = readHeaderValue(req.headers.authorization);
  const headerToken = readHeaderValue(req.headers['x-product-platform-token']);
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : undefined;
  const providedToken = headerToken?.trim() || bearerToken;

  if (!providedToken || providedToken !== configuredToken) {
    const error = new Error('Unauthorized product-platform request.');
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
}
