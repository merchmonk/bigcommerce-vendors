import type {
  EndpointMappingDraft,
  PromostandardsCapabilityMatrix,
  PromostandardsEndpointCapability,
  VendorFormData,
  VendorType,
} from '../../types';
import { resolveMappingDrafts, type ResolvedMappingDraft } from '../etl/mappingDrafts';
import { listEndpointMappingsByIds } from '../etl/repository';
import { buildVendorConnectionConfig, getVendorConnectionSections } from './vendorConfig';
import { resolvePromostandardsCapabilityMappings } from './promostandardsDiscovery';
import type { Vendor, VendorInput } from '../vendors';

export interface VendorSubmissionInput extends Partial<VendorInput> {
  vendor_name?: string;
  vendor_type?: VendorType;
  endpoint_mappings?: EndpointMappingDraft[];
  connection_tested?: boolean;
  custom_api_service_type?: VendorFormData['custom_api_service_type'];
  custom_api_format_data?: VendorFormData['custom_api_format_data'];
  hasCompanyDataEndpoint?: boolean;
  companyDataEndpointUrl?: string;
  promostandardsEndpoints?: VendorFormData['promostandardsEndpoints'];
  promostandardsCapabilities?: VendorFormData['promostandardsCapabilities'];
  promostandards_capabilities?: VendorFormData['promostandardsCapabilities'];
}

export interface PreparedVendorSubmission {
  vendorInput: VendorInput;
  mappingAction:
    | { type: 'apply'; resolvedDrafts: ResolvedMappingDraft[] }
    | { type: 'clear' }
    | { type: 'preserve' };
}

function makeError(message: string, statusCode = 400): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function requireVendorName(vendorName: string | undefined): string {
  const normalized = vendorName?.trim();
  if (!normalized) {
    throw makeError('vendor_name is required');
  }

  return normalized;
}

function normalizeEndpointMappingIds(mappingIds: number[] | undefined): number[] {
  if (!Array.isArray(mappingIds)) {
    return [];
  }

  return mappingIds.filter((mappingId): mappingId is number => Number.isInteger(mappingId) && mappingId > 0);
}

function normalizePromostandardsCapabilities(input: {
  body: VendorSubmissionInput;
  existingCapabilities?: PromostandardsCapabilityMatrix;
}): PromostandardsCapabilityMatrix | null {
  const explicitCapabilities =
    input.body.promostandardsCapabilities ??
    input.body.promostandards_capabilities ??
    null;

  if (explicitCapabilities) {
    return explicitCapabilities;
  }

  if (Array.isArray(input.body.promostandardsEndpoints)) {
    return {
      fingerprint: '',
      testedAt: new Date().toISOString(),
      availableEndpointCount: input.body.promostandardsEndpoints.filter(endpoint => endpoint.available).length,
      credentialsValid: null,
      endpoints: input.body.promostandardsEndpoints,
    };
  }

  return input.existingCapabilities ?? null;
}

function buildEndpointSelectionKey(endpointName: string, endpointVersion: string | null | undefined): string {
  return `${endpointName}|${endpointVersion ?? ''}`;
}

function buildStoredPromostandardsCapabilities(input: {
  capabilities: PromostandardsCapabilityMatrix;
  mappings: Awaited<ReturnType<typeof listEndpointMappingsByIds>>;
}): PromostandardsCapabilityMatrix {
  const selectedKeys = new Set(
    input.mappings.map(mapping => buildEndpointSelectionKey(mapping.endpoint_name, mapping.endpoint_version)),
  );

  const endpoints = input.capabilities.endpoints
    .filter(endpoint => endpoint.available && !!endpoint.endpointVersion)
    .filter(endpoint => selectedKeys.has(buildEndpointSelectionKey(endpoint.endpointName, endpoint.endpointVersion)))
    .filter(
      (endpoint, index, values) =>
        values.findIndex(
          value =>
            value.endpointName === endpoint.endpointName &&
            value.endpointVersion === endpoint.endpointVersion,
        ) === index,
    );

  return {
    fingerprint: input.capabilities.fingerprint,
    testedAt: input.capabilities.testedAt,
    availableEndpointCount: endpoints.length,
    credentialsValid: input.capabilities.credentialsValid ?? null,
    endpoints,
  };
}

function resolvePromostandardsEndpointUrl(input: {
  mapping: Awaited<ReturnType<typeof listEndpointMappingsByIds>>[number];
  capabilities: PromostandardsCapabilityMatrix;
}): string {
  const capability = input.capabilities.endpoints.find(
    endpoint =>
      endpoint.endpointName === input.mapping.endpoint_name &&
      endpoint.endpointVersion === input.mapping.endpoint_version,
  );

  const endpointUrl = capability?.endpointUrl?.trim();
  if (!endpointUrl) {
    throw makeError(
      `Missing endpoint URL for ${input.mapping.endpoint_name} ${input.mapping.endpoint_version}.`,
    );
  }

  return endpointUrl;
}

export async function prepareVendorSubmission(input: {
  body: VendorSubmissionInput;
  existingVendor?: Vendor | null;
}): Promise<PreparedVendorSubmission> {
  const existingVendor = input.existingVendor ?? null;
  const integrationFamily = input.body.integration_family ?? existingVendor?.integration_family ?? 'CUSTOM';
  const apiProtocol =
    input.body.api_protocol ??
    existingVendor?.api_protocol ??
    (integrationFamily === 'PROMOSTANDARDS' ? 'SOAP' : null);
  const vendorApiUrl = input.body.vendor_api_url ?? existingVendor?.vendor_api_url ?? undefined;
  const vendorAccountId = input.body.vendor_account_id ?? existingVendor?.vendor_account_id ?? undefined;
  const vendorSecret = input.body.vendor_secret ?? existingVendor?.vendor_secret ?? undefined;

  const existingSections = getVendorConnectionSections(existingVendor?.connection_config ?? {});
  const promostandardsCapabilities = normalizePromostandardsCapabilities({
    body: input.body,
    existingCapabilities: existingSections.promostandards_capabilities,
  });
  const customApiServiceType =
    input.body.custom_api_service_type ?? existingSections.custom_api?.service_type;
  const customApiFormatData =
    input.body.custom_api_format_data ?? existingSections.custom_api?.format_data;
  let connectionConfig = buildVendorConnectionConfig({
    existingConfig: existingVendor?.connection_config,
    integrationFamily,
    customApiServiceType,
    customApiFormatData,
    promostandardsCapabilities,
  });

  let mappingAction: PreparedVendorSubmission['mappingAction'] = { type: 'preserve' };
  if (integrationFamily === 'PROMOSTANDARDS') {
    if (
      !promostandardsCapabilities ||
      promostandardsCapabilities.availableEndpointCount < 1 ||
      input.body.connection_tested !== true
    ) {
      throw makeError('Please run Test Vendor successfully before saving this PromoStandards vendor.');
    }

    const submittedMappingIds = normalizeEndpointMappingIds(input.body.endpoint_mapping_ids);
    const mappingIds =
      submittedMappingIds.length > 0
        ? submittedMappingIds
        : await resolvePromostandardsCapabilityMappings(promostandardsCapabilities);
    if (mappingIds.length === 0) {
      throw makeError('At least one available PromoStandards endpoint is required.');
    }

    const selectedMappings = await listEndpointMappingsByIds(mappingIds);
    const storedCapabilities = buildStoredPromostandardsCapabilities({
      capabilities: promostandardsCapabilities,
      mappings: selectedMappings,
    });
    connectionConfig = buildVendorConnectionConfig({
      existingConfig: existingVendor?.connection_config,
      integrationFamily,
      customApiServiceType,
      customApiFormatData,
      promostandardsCapabilities: storedCapabilities,
    });

    mappingAction = {
      type: 'apply',
      resolvedDrafts: selectedMappings.map(mapping => ({
        mappingId: mapping.endpoint_mapping_id,
        enabled: true,
        runtimeConfig: {},
        endpointUrl: resolvePromostandardsEndpointUrl({
          mapping,
          capabilities: promostandardsCapabilities,
        }),
      })),
    };
  } else if (!customApiServiceType) {
    throw makeError('custom_api_service_type is required for non-PromoStandards vendors');
  } else if (Array.isArray(input.body.endpoint_mappings) && input.body.endpoint_mappings.length > 0) {
    mappingAction = {
      type: 'apply',
      resolvedDrafts: await resolveMappingDrafts({
        integrationFamily,
        defaultProtocol: apiProtocol ?? 'REST',
        drafts: input.body.endpoint_mappings,
      }),
    };
  } else if (existingVendor && existingVendor.integration_family !== integrationFamily) {
    mappingAction = { type: 'clear' };
  }

  return {
    vendorInput: {
      vendor_name: requireVendorName(input.body.vendor_name ?? existingVendor?.vendor_name),
      vendor_type: input.body.vendor_type ?? existingVendor?.vendor_type ?? 'SUPPLIER',
      vendor_api_url: vendorApiUrl,
      vendor_account_id: vendorAccountId,
      vendor_secret: vendorSecret,
      integration_family: integrationFamily,
      api_protocol: apiProtocol ?? undefined,
      connection_config: connectionConfig,
      is_active: input.body.is_active ?? existingVendor?.is_active ?? true,
    },
    mappingAction,
  };
}
