import type {
  CustomApiServiceType,
  IntegrationFamily,
  PromostandardsCapabilityMatrix,
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
