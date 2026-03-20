import type { IntegrationJobKind, MappingProtocol } from '../../types';
import { listEnabledVendorEndpointMappings } from '../etl/repository';
import {
  getAuxiliaryCapabilityKeysForJobKind,
  getPrimaryCapabilityPreferenceKeysForJobKind,
} from './promostandardsOrderCapabilities';

export interface VendorResolvedOrderCapability {
  vendor_endpoint_mapping_id: number;
  mapping_id: number;
  capability_key: string;
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: MappingProtocol;
  runtime_config: Record<string, unknown>;
  lifecycle_role: string | null;
  optional_by_vendor: boolean;
  recommended_poll_minutes: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toVendorResolvedOrderCapability(
  value: Awaited<ReturnType<typeof listEnabledVendorEndpointMappings>>[number],
): VendorResolvedOrderCapability | null {
  const metadata = asRecord(value.mapping.metadata);
  if (metadata.capability_scope !== 'order') {
    return null;
  }

  const capabilityKey =
    typeof metadata.capability_key === 'string' && metadata.capability_key.trim()
      ? metadata.capability_key.trim()
      : `${value.mapping.endpoint_name}:${value.mapping.endpoint_version}:${value.mapping.operation_name}`;

  return {
    vendor_endpoint_mapping_id: value.vendor_endpoint_mapping_id,
    mapping_id: value.mapping_id,
    capability_key: capabilityKey,
    endpoint_name: value.mapping.endpoint_name,
    endpoint_version: value.mapping.endpoint_version,
    operation_name: value.mapping.operation_name,
    protocol: value.mapping.protocol,
    runtime_config: value.runtime_config ?? {},
    lifecycle_role: typeof metadata.lifecycle_role === 'string' ? metadata.lifecycle_role : null,
    optional_by_vendor: metadata.optional_by_vendor === true,
    recommended_poll_minutes:
      typeof metadata.recommended_poll_minutes === 'number'
        ? metadata.recommended_poll_minutes
        : null,
  };
}

export async function listVendorResolvedOrderCapabilities(
  vendorId: number,
): Promise<VendorResolvedOrderCapability[]> {
  const mappings = await listEnabledVendorEndpointMappings(vendorId);

  return mappings
    .map(toVendorResolvedOrderCapability)
    .filter((value): value is VendorResolvedOrderCapability => Boolean(value))
    .sort((left, right) => left.capability_key.localeCompare(right.capability_key));
}

export async function resolvePrimaryOrderCapabilityForJobKind(
  vendorId: number,
  jobKind: IntegrationJobKind,
): Promise<VendorResolvedOrderCapability | null> {
  const capabilities = await listVendorResolvedOrderCapabilities(vendorId);
  return resolvePrimaryOrderCapabilityFromList(capabilities, jobKind);
}

export function resolvePrimaryOrderCapabilityFromList(
  capabilities: VendorResolvedOrderCapability[],
  jobKind: IntegrationJobKind,
): VendorResolvedOrderCapability | null {
  const preferredKeys = getPrimaryCapabilityPreferenceKeysForJobKind(jobKind);
  for (const capabilityKey of preferredKeys) {
    const capability = capabilities.find(candidate => candidate.capability_key === capabilityKey);
    if (capability) {
      return capability;
    }
  }

  return null;
}

export function resolveAuxiliaryOrderCapabilitiesFromList(
  capabilities: VendorResolvedOrderCapability[],
  jobKind: IntegrationJobKind,
): VendorResolvedOrderCapability[] {
  const auxiliaryKeys = new Set(getAuxiliaryCapabilityKeysForJobKind(jobKind));
  if (auxiliaryKeys.size === 0) {
    return [];
  }

  return capabilities.filter(capability => auxiliaryKeys.has(capability.capability_key));
}

export async function resolveAuxiliaryOrderCapabilitiesForJobKind(
  vendorId: number,
  jobKind: IntegrationJobKind,
): Promise<VendorResolvedOrderCapability[]> {
  const capabilities = await listVendorResolvedOrderCapabilities(vendorId);
  return resolveAuxiliaryOrderCapabilitiesFromList(capabilities, jobKind);
}

export function getRecommendedPollMinutes(
  capabilities: VendorResolvedOrderCapability[],
  capabilityKeys: string[],
): number | null {
  for (const capabilityKey of capabilityKeys) {
    const capability = capabilities.find(candidate => candidate.capability_key === capabilityKey);
    if (capability?.recommended_poll_minutes && capability.recommended_poll_minutes > 0) {
      return capability.recommended_poll_minutes;
    }
  }

  return null;
}
