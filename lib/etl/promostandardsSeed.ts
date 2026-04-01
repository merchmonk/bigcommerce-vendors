import type { EndpointMapping } from '../../types';
import { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { PROMOSTANDARDS_SEED_RECORDS } from '../../prisma/seeds/promostandards';

function serializeEndpointMapping(row: {
  endpoint_mapping_id: number;
  standard_type: 'PROMOSTANDARDS' | 'CUSTOM';
  endpoint_name: string;
  endpoint_version: string;
  operation_name: string;
  protocol: 'SOAP' | 'REST' | 'RPC' | 'XML' | 'JSON';
  payload_format: 'JSON' | 'XML';
  is_product_endpoint: boolean;
  structure_json: unknown;
  structure_xml: string | null;
  request_schema: unknown;
  response_schema: unknown;
  transform_schema: unknown;
  metadata: unknown;
  created_at: Date;
  updated_at: Date;
}): EndpointMapping {
  return {
    ...row,
    structure_json: (row.structure_json ?? {}) as Record<string, unknown>,
    request_schema: (row.request_schema ?? {}) as Record<string, unknown>,
    response_schema: (row.response_schema ?? {}) as Record<string, unknown>,
    transform_schema: (row.transform_schema ?? {}) as Record<string, unknown>,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function seedPromoStandardsMappings(): Promise<EndpointMapping[]> {
  const seeded: EndpointMapping[] = [];

  for (const record of PROMOSTANDARDS_SEED_RECORDS) {
    const structureJson = record.structure_json as Prisma.InputJsonValue;
    const requestSchema = record.request_schema as Prisma.InputJsonValue;
    const responseSchema = record.response_schema as Prisma.InputJsonValue;
    const transformSchema = record.transform_schema as Prisma.InputJsonValue;
    const metadata = record.metadata as Prisma.InputJsonValue;

    const row = await prisma.endpointMapping.upsert({
      where: {
        standard_type_endpoint_name_endpoint_version_operation_name: {
          standard_type: record.standard_type,
          endpoint_name: record.endpoint_name,
          endpoint_version: record.endpoint_version,
          operation_name: record.operation_name,
        },
      },
      update: {
        protocol: record.protocol,
        payload_format: record.payload_format,
        is_product_endpoint: record.is_product_endpoint,
        structure_json: structureJson,
        structure_xml: record.structure_xml,
        request_schema: requestSchema,
        response_schema: responseSchema,
        transform_schema: transformSchema,
        metadata,
        updated_at: new Date(),
      },
      create: {
        standard_type: record.standard_type,
        endpoint_name: record.endpoint_name,
        endpoint_version: record.endpoint_version,
        operation_name: record.operation_name,
        protocol: record.protocol,
        payload_format: record.payload_format,
        is_product_endpoint: record.is_product_endpoint,
        structure_json: structureJson,
        structure_xml: record.structure_xml,
        request_schema: requestSchema,
        response_schema: responseSchema,
        transform_schema: transformSchema,
        metadata,
      },
    });

    seeded.push(
      serializeEndpointMapping({
        ...row,
        standard_type: row.standard_type as 'PROMOSTANDARDS' | 'CUSTOM',
        protocol: row.protocol as 'SOAP' | 'REST' | 'RPC' | 'XML' | 'JSON',
        payload_format: row.payload_format as 'JSON' | 'XML',
      }),
    );
  }

  return seeded;
}
