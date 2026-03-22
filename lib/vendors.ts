import type { MappingProtocol, MappingStandardType, VendorType } from '../types';
import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { replaceVendorEndpointMappings } from './etl/repository';

export type IntegrationFamily = MappingStandardType;
export type ApiProtocol = MappingProtocol;

export interface Vendor {
  vendor_id: number;
  vendor_name: string;
  vendor_type: VendorType;
  vendor_api_url: string | null;
  vendor_account_id: string | null;
  vendor_secret: string | null;
  integration_family: IntegrationFamily;
  api_protocol: ApiProtocol | null;
  connection_config: Record<string, unknown>;
  is_active: boolean;
  datetime_added: string;
  datetime_modified: string;
}

export interface VendorInput {
  vendor_name: string;
  vendor_type?: VendorType;
  vendor_api_url?: string;
  vendor_account_id?: string;
  vendor_secret?: string;
  integration_family: IntegrationFamily;
  api_protocol?: ApiProtocol | null;
  endpoint_mapping_ids?: number[];
  connection_config?: Record<string, unknown>;
  is_active?: boolean;
}

function makeVendorError(message: string, statusCode = 400): Error & { statusCode?: number } {
  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = statusCode;
  return error;
}

function normalizeVendorApiUrl(vendorApiUrl: string | null | undefined): string | null {
  const trimmed = vendorApiUrl?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.username = '';
    url.password = '';

    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
      url.port = '';
    }

    const normalizedPath = url.pathname.replace(/\/+$/, '');
    url.pathname = normalizedPath || '/';

    const serialized = url.toString();
    return serialized.endsWith('/') && url.pathname === '/' ? serialized.slice(0, -1) : serialized;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

async function assertVendorApiUrlIsUnique(input: {
  vendorApiUrl?: string | null;
  excludeVendorId?: number;
}): Promise<void> {
  const normalizedVendorApiUrl = normalizeVendorApiUrl(input.vendorApiUrl);
  if (!normalizedVendorApiUrl) {
    return;
  }

  const existingVendors = await prisma.vendor.findMany({
    where: {
      vendor_api_url: {
        not: null,
      },
      ...(typeof input.excludeVendorId === 'number'
        ? {
            vendor_id: {
              not: input.excludeVendorId,
            },
          }
        : {}),
    },
    select: {
      vendor_id: true,
      vendor_name: true,
      vendor_api_url: true,
    },
  });

  const duplicateVendor = existingVendors.find(
    vendor => normalizeVendorApiUrl(vendor.vendor_api_url) === normalizedVendorApiUrl,
  );

  if (duplicateVendor) {
    throw makeVendorError(
      `A vendor already exists for ${normalizedVendorApiUrl}${duplicateVendor.vendor_name ? ` (${duplicateVendor.vendor_name})` : ''}.`,
      409,
    );
  }
}

function serializeVendor(row: {
  vendor_id: number;
  vendor_name: string;
  vendor_type: VendorType;
  vendor_api_url: string | null;
  vendor_account_id: string | null;
  vendor_secret: string | null;
  integration_family: IntegrationFamily;
  api_protocol: ApiProtocol | null;
  connection_config: unknown;
  is_active: boolean;
  datetime_added: Date;
  datetime_modified: Date;
}): Vendor {
  return {
    ...row,
    connection_config: (row.connection_config ?? {}) as Record<string, unknown>,
    datetime_added: row.datetime_added.toISOString(),
    datetime_modified: row.datetime_modified.toISOString(),
  };
}

function toJson(value: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function listVendors(includeInactive = false): Promise<Vendor[]> {
  const rows = await prisma.vendor.findMany({
    where: includeInactive ? undefined : { is_active: true },
    orderBy: { vendor_name: 'asc' },
  });
  return rows.map(serializeVendor);
}

export async function getVendorById(vendorId: number): Promise<Vendor | null> {
  const row = await prisma.vendor.findUnique({
    where: { vendor_id: vendorId },
  });
  return row ? serializeVendor(row) : null;
}

export async function createVendor(input: VendorInput): Promise<Vendor> {
  await assertVendorApiUrlIsUnique({
    vendorApiUrl: input.vendor_api_url,
  });

  const row = await prisma.vendor.create({
    data: {
      vendor_name: input.vendor_name,
      vendor_type: input.vendor_type ?? 'SUPPLIER',
      vendor_api_url: input.vendor_api_url ?? null,
      vendor_account_id: input.vendor_account_id ?? null,
      vendor_secret: input.vendor_secret ?? null,
      integration_family: input.integration_family,
      api_protocol: input.api_protocol ?? null,
      connection_config: toJson(input.connection_config),
      is_active: input.is_active ?? true,
    },
  });
  if (input.endpoint_mapping_ids?.length) {
    await replaceVendorEndpointMappings(row.vendor_id, input.endpoint_mapping_ids);
  }
  return serializeVendor(row);
}

export async function updateVendor(vendorId: number, input: Partial<VendorInput>): Promise<Vendor | null> {
  const existing = await prisma.vendor.findUnique({
    where: { vendor_id: vendorId },
  });
  if (!existing) return null;

  await assertVendorApiUrlIsUnique({
    vendorApiUrl: input.vendor_api_url ?? existing.vendor_api_url,
    excludeVendorId: vendorId,
  });

  const row = await prisma.vendor.update({
    where: { vendor_id: vendorId },
    data: {
      vendor_name: input.vendor_name ?? existing.vendor_name,
      vendor_type: input.vendor_type ?? existing.vendor_type,
      vendor_api_url: input.vendor_api_url ?? existing.vendor_api_url,
      vendor_account_id: input.vendor_account_id ?? existing.vendor_account_id,
      vendor_secret: input.vendor_secret ?? existing.vendor_secret,
      integration_family: input.integration_family ?? existing.integration_family,
      api_protocol: input.api_protocol ?? existing.api_protocol,
      connection_config: input.connection_config
        ? toJson(input.connection_config)
        : (existing.connection_config as Prisma.InputJsonValue),
      is_active: input.is_active ?? existing.is_active,
      datetime_modified: new Date(),
    },
  });

  if (input.endpoint_mapping_ids) {
    await replaceVendorEndpointMappings(vendorId, input.endpoint_mapping_ids);
  }

  return serializeVendor(row);
}

export async function deactivateVendor(vendorId: number): Promise<void> {
  await prisma.vendor.updateMany({
    where: { vendor_id: vendorId },
    data: {
      is_active: false,
      datetime_modified: new Date(),
    },
  });
}

export async function deleteVendor(vendorId: number): Promise<void> {
  await prisma.vendor.deleteMany({
    where: { vendor_id: vendorId },
  });
}
