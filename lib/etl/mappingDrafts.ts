import type { EndpointMappingDraft, IntegrationFamily } from '../../types';
import type { MappingProtocol, MappingStandardType } from '../../types';
import {
  replaceVendorEndpointMappings,
  upsertEndpointMapping,
  upsertVendorEndpointMapping,
} from './repository';

interface ResolvedMappingDraft {
  mappingId: number;
  enabled: boolean;
  runtimeConfig: Record<string, unknown>;
}

function getStandardType(integrationFamily: IntegrationFamily): MappingStandardType {
  return integrationFamily === 'PROMOSTANDARDS' ? 'PROMOSTANDARDS' : 'CUSTOM';
}

function parseStructureInput(
  structureInput: string | undefined,
  payloadFormat: 'JSON' | 'XML',
): { structure_json: Record<string, unknown>; structure_xml: string | null } {
  const normalized = (structureInput ?? '').trim();
  if (!normalized) {
    return {
      structure_json: {},
      structure_xml: null,
    };
  }

  if (payloadFormat === 'XML') {
    return {
      structure_json: {},
      structure_xml: normalized,
    };
  }

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    return {
      structure_json: parsed ?? {},
      structure_xml: null,
    };
  } catch {
    throw new Error('Invalid JSON structure provided in mapping draft');
  }
}

function resolveProtocol(draft: EndpointMappingDraft, fallback: MappingProtocol): MappingProtocol {
  return draft.protocol ?? fallback;
}

function getRuntimeConfig(draft: EndpointMappingDraft): Record<string, unknown> {
  return {
    ...(draft.runtime_config ?? {}),
  };
}

export async function resolveMappingDrafts(input: {
  integrationFamily: IntegrationFamily;
  defaultProtocol: MappingProtocol;
  drafts: EndpointMappingDraft[];
}): Promise<ResolvedMappingDraft[]> {
  const output: ResolvedMappingDraft[] = [];
  const standardType = getStandardType(input.integrationFamily);

  for (const draft of input.drafts) {
    if (!draft.enabled) continue;

    if (draft.mapping_id && !draft.endpoint_name) {
      output.push({
        mappingId: draft.mapping_id,
        enabled: true,
        runtimeConfig: getRuntimeConfig(draft),
      });
      continue;
    }

    if (!draft.endpoint_name || !draft.endpoint_version || !draft.operation_name) {
      throw new Error('Each endpoint mapping requires endpoint name, version, and operation');
    }

    const protocol = resolveProtocol(draft, input.defaultProtocol);
    const payloadFormat = draft.payload_format ?? (protocol === 'XML' || protocol === 'SOAP' ? 'XML' : 'JSON');
    const structure = parseStructureInput(draft.structure_input, payloadFormat);

    const mapping = await upsertEndpointMapping({
      standard_type: standardType,
      endpoint_name: draft.endpoint_name,
      endpoint_version: draft.endpoint_version,
      operation_name: draft.operation_name,
      protocol,
      payload_format: payloadFormat,
      is_product_endpoint: draft.is_product_endpoint,
      structure_json: structure.structure_json,
      structure_xml: structure.structure_xml,
      transform_schema: draft.transform_schema ?? {},
      metadata: draft.metadata ?? {},
    });

    output.push({
      mappingId: mapping.mapping_id,
      enabled: true,
      runtimeConfig: getRuntimeConfig(draft),
    });
  }

  return output;
}

export async function applyVendorMappingDrafts(
  vendorId: number,
  resolvedDrafts: ResolvedMappingDraft[],
): Promise<void> {
  const mappingIds = resolvedDrafts.map(item => item.mappingId);
  await replaceVendorEndpointMappings(vendorId, mappingIds);

  for (const resolved of resolvedDrafts) {
    await upsertVendorEndpointMapping({
      vendor_id: vendorId,
      mapping_id: resolved.mappingId,
      is_enabled: resolved.enabled,
      runtime_config: resolved.runtimeConfig,
    });
  }
}
