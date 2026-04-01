function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function hasExplicitRuntimeEndpointOverride(
  runtimeConfig?: Record<string, unknown> | null,
): boolean {
  const config = runtimeConfig ?? {};
  return Boolean(
    readString(config.endpoint_url) ||
      readString(config.endpointUrl) ||
      readString(config.endpoint_path) ||
      readString(config.endpointPath) ||
      readString(config.custom_endpoint_path),
  );
}

function joinEndpointPrefix(baseUrl: string, suffix: string): string {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, '');
  const normalizedSuffix = suffix.trim().replace(/^\/+/, '');
  if (!normalizedBase) {
    return suffix.trim();
  }
  if (!normalizedSuffix) {
    return normalizedBase;
  }
  return `${normalizedBase}/${normalizedSuffix}`;
}

export function resolveRuntimeEndpointUrl(input: {
  vendorApiUrl?: string | null;
  runtimeConfig?: Record<string, unknown> | null;
}): string {
  const vendorApiUrl = readString(input.vendorApiUrl);
  const runtimeConfig = input.runtimeConfig ?? {};
  const configuredUrl = readString(runtimeConfig.endpoint_url) || readString(runtimeConfig.endpointUrl);
  const configuredPath =
    readString(runtimeConfig.endpoint_path) ||
    readString(runtimeConfig.endpointPath) ||
    readString(runtimeConfig.custom_endpoint_path);

  if (configuredUrl) {
    if (/^https?:\/\//i.test(configuredUrl)) {
      return configuredUrl;
    }
    return joinEndpointPrefix(vendorApiUrl, configuredUrl);
  }

  if (configuredPath) {
    return joinEndpointPrefix(vendorApiUrl, configuredPath);
  }

  return vendorApiUrl;
}
