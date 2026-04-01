import type {
  CustomApiServiceType,
  EndpointMappingDraft,
  IntegrationFamily,
  PromostandardsCapabilityMatrix,
  PromostandardsEndpointCapability,
} from '../../types';

interface VendorConnectionSections {
  custom_api?: {
    service_type?: CustomApiServiceType;
    format_data?: string;
  };
  promostandards_capabilities?: PromostandardsCapabilityMatrix;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

interface PromostandardsEndpointUrlOverride {
  endpointName?: string;
  endpointVersion?: string | null;
  endpointUrl?: string | null;
}

export function getVendorConnectionSections(connectionConfig: unknown): VendorConnectionSections {
  const record = asRecord(connectionConfig);
  const customApi = asRecord(record.custom_api);
  const promostandards = asRecord(record.promostandards_capabilities);

  return {
    custom_api: {
      service_type: typeof customApi.service_type === 'string'
        ? (customApi.service_type as CustomApiServiceType)
        : undefined,
      format_data: typeof customApi.format_data === 'string' ? customApi.format_data : undefined,
    },
    promostandards_capabilities:
      typeof promostandards.fingerprint === 'string' && Array.isArray(promostandards.endpoints)
        ? (promostandards as unknown as PromostandardsCapabilityMatrix)
        : undefined,
  };
}

export function buildVendorConnectionConfig(input: {
  existingConfig?: Record<string, unknown>;
  integrationFamily: IntegrationFamily;
  customApiServiceType?: CustomApiServiceType;
  customApiFormatData?: string;
  promostandardsCapabilities?: PromostandardsCapabilityMatrix | null;
}): Record<string, unknown> {
  const nextConfig = {
    ...(input.existingConfig ?? {}),
  };

  delete nextConfig.custom_api;
  delete nextConfig.promostandards_capabilities;

  if (input.integrationFamily === 'PROMOSTANDARDS' && input.promostandardsCapabilities) {
    nextConfig.promostandards_capabilities = input.promostandardsCapabilities;
  }

  if (input.integrationFamily === 'CUSTOM') {
    nextConfig.custom_api = {
      service_type: input.customApiServiceType,
      format_data: input.customApiFormatData?.trim() || '',
    };
  }

  return nextConfig;
}

export function applyPromostandardsEndpointUrlOverrides(input: {
  capabilities?: PromostandardsCapabilityMatrix | null;
  endpointUrls?: PromostandardsEndpointUrlOverride[];
}): PromostandardsCapabilityMatrix | undefined {
  const capabilities = input.capabilities ?? undefined;
  if (!capabilities || !Array.isArray(input.endpointUrls) || input.endpointUrls.length === 0) {
    return capabilities ?? undefined;
  }

  const overrideBySelection = new Map(
    input.endpointUrls.map(endpoint => [
      `${endpoint.endpointName ?? ''}|${endpoint.endpointVersion ?? ''}`,
      readString(endpoint.endpointUrl),
    ]),
  );

  return {
    ...capabilities,
    endpoints: capabilities.endpoints.map(endpoint => {
      const runtimeConfig = overrideBySelection.get(
        `${endpoint.endpointName}|${endpoint.endpointVersion ?? ''}`,
      );
      if (!runtimeConfig) {
        return endpoint;
      }

      return {
        ...endpoint,
        endpointUrl: runtimeConfig ?? endpoint.endpointUrl,
      };
    }),
  };
}

export function buildPromostandardsCapabilitiesFromSavedEndpoints(input: {
  existingCapabilities?: PromostandardsCapabilityMatrix | null;
  endpointUrls?: PromostandardsEndpointUrlOverride[];
}): PromostandardsCapabilityMatrix | null {
  const existingCapabilities = input.existingCapabilities ?? null;
  const endpointUrls = input.endpointUrls ?? [];

  if (existingCapabilities) {
    return applyPromostandardsEndpointUrlOverrides({
      capabilities: existingCapabilities,
      endpointUrls,
    }) ?? existingCapabilities;
  }

  if (endpointUrls.length === 0) {
    return null;
  }

  const endpoints = endpointUrls
    .filter(endpoint => endpoint.endpointName && endpoint.endpointUrl)
    .map<PromostandardsEndpointCapability>(endpoint => ({
      endpointName: endpoint.endpointName!,
      endpointVersion: endpoint.endpointVersion ?? null,
      endpointUrl: endpoint.endpointUrl ?? '',
      available: true,
      status_code: 200,
      message: 'Endpoint loaded from saved vendor configuration.',
      wsdl_available: null,
      credentials_valid: null,
      live_probe_message: null,
      versionDetectionStatus: endpoint.endpointVersion ? 'manual' : 'failed',
      requiresManualVersionSelection: !endpoint.endpointVersion,
      availableVersions: [],
    }));

  return {
    fingerprint: '',
    testedAt: new Date(0).toISOString(),
    availableEndpointCount: endpoints.length,
    credentialsValid: null,
    endpoints,
  };
}

export function getCustomApiServiceTypeLabel(serviceType: CustomApiServiceType | undefined): string {
  if (!serviceType) return 'Other';

  switch (serviceType) {
    case 'REST_API':
      return 'REST API';
    case 'SOAP_API':
      return 'SOAP API';
    case 'JSON_FEED':
      return 'JSON Feed';
    case 'XML_FEED':
      return 'XML Feed';
    case 'CSV_FEED':
      return 'CSV Feed';
    default:
      return serviceType;
  }
}
