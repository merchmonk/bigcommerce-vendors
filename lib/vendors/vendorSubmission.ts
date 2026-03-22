import type { EndpointMappingDraft, VendorFormData, VendorType } from '../../types';
import { resolveMappingDrafts, type ResolvedMappingDraft } from '../etl/mappingDrafts';
import { listEndpointMappingsByIds } from '../etl/repository';
import { buildVendorConnectionConfig, getVendorConnectionSections } from './vendorConfig';
import {
  isPromostandardsCapabilityMatrixCurrent,
  resolvePromostandardsCapabilityMappings,
} from './promostandardsDiscovery';
import type { Vendor, VendorInput } from '../vendors';

export interface VendorSubmissionInput extends Partial<VendorInput> {
  vendor_name?: string;
  vendor_type?: VendorType;
  endpoint_mappings?: EndpointMappingDraft[];
  connection_tested?: boolean;
  custom_api_service_type?: VendorFormData['custom_api_service_type'];
  custom_api_format_data?: VendorFormData['custom_api_format_data'];
  promostandards_capabilities?: VendorFormData['promostandards_capabilities'];
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

async function buildStoredPromostandardsCapabilities(input: {
  capabilities: NonNullable<VendorFormData['promostandards_capabilities']>;
  endpointMappingIds: number[];
}): Promise<NonNullable<VendorFormData['promostandards_capabilities']>> {
  const mappings = await listEndpointMappingsByIds(input.endpointMappingIds);

  return {
    fingerprint: input.capabilities.fingerprint,
    tested_at: input.capabilities.tested_at,
    available_endpoint_count: mappings.length,
    credentials_valid: input.capabilities.credentials_valid ?? null,
    endpoints: mappings.map(mapping => {
      const metadata = (mapping.metadata ?? {}) as Record<string, unknown>;

      return {
        endpoint_name: mapping.endpoint_name,
        endpoint_version: mapping.endpoint_version,
        operation_name: mapping.operation_name,
        capability_scope:
          typeof metadata.capability_scope === 'string'
            ? (metadata.capability_scope as 'catalog' | 'order')
            : undefined,
        lifecycle_role: typeof metadata.lifecycle_role === 'string' ? metadata.lifecycle_role : undefined,
        optional_by_vendor:
          typeof metadata.optional_by_vendor === 'boolean' ? metadata.optional_by_vendor : undefined,
        recommended_poll_minutes:
          typeof metadata.recommended_poll_minutes === 'number' ? metadata.recommended_poll_minutes : null,
        available: true,
        status_code: null,
        message: 'Endpoint selected from PromoStandards discovery.',
      };
    }),
  };
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
  const promostandardsCapabilities =
    input.body.promostandards_capabilities ?? existingSections.promostandards_capabilities;
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
    if (!vendorApiUrl) {
      throw makeError('vendor_api_url is required for PromoStandards vendors');
    }

    if (
      !promostandardsCapabilities ||
      promostandardsCapabilities.available_endpoint_count < 1 ||
      !isPromostandardsCapabilityMatrixCurrent(promostandardsCapabilities, {
        vendor_api_url: vendorApiUrl,
        vendor_account_id: vendorAccountId ?? null,
        vendor_secret: vendorSecret ?? null,
        api_protocol: apiProtocol ?? undefined,
      })
    ) {
      throw makeError('Please run Test Vendor again so PromoStandards capabilities can be rediscovered.');
    }

    const submittedMappingIds = normalizeEndpointMappingIds(input.body.endpoint_mapping_ids);
    const mappingIds =
      submittedMappingIds.length > 0
        ? submittedMappingIds
        : await resolvePromostandardsCapabilityMappings(promostandardsCapabilities);
    if (mappingIds.length === 0) {
      throw makeError('At least one available PromoStandards endpoint is required.');
    }

    const storedCapabilities = await buildStoredPromostandardsCapabilities({
      capabilities: promostandardsCapabilities,
      endpointMappingIds: mappingIds,
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
      resolvedDrafts: mappingIds.map(mappingId => ({
        mappingId,
        enabled: true,
        runtimeConfig: {},
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
