import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { getS3Client } from './awsClients';
import { getRequestContext } from './requestContext';
import { redactValue } from './telemetry';

export interface SnapshotArchiveReference {
  bucket: string;
  key: string;
}

export interface SnapshotArchiveInput {
  category: 'vendor-api' | 'bigcommerce-api' | 'internal-failure';
  action: string;
  payload: Record<string, unknown>;
}

function getSnapshotBucket(): string | undefined {
  return process.env.SNAPSHOT_ARCHIVE_BUCKET;
}

export async function writeSnapshotArchive(
  input: SnapshotArchiveInput,
): Promise<SnapshotArchiveReference | null> {
  const bucket = getSnapshotBucket();
  if (!bucket || process.env.NODE_ENV === 'test') {
    return null;
  }

  const context = getRequestContext();
  const prefix = new Date().toISOString().slice(0, 10);
  const key = [
    input.category,
    prefix,
    context?.vendorId ?? 'global',
    context?.correlationId ?? randomUUID(),
    `${input.action}-${randomUUID()}.json`,
  ].join('/');

  const body = JSON.stringify(
    redactValue({
      ...input.payload,
      archived_at: new Date().toISOString(),
      correlation_id: context?.correlationId,
      vendor_id: context?.vendorId,
      integration_job_id: context?.integrationJobId,
    }),
    null,
    2,
  );

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
    }),
  );

  return {
    bucket,
    key,
  };
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body) {
    return '';
  }

  if (typeof body === 'string') {
    return body;
  }

  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }

  throw new Error('Unsupported snapshot archive body type.');
}

export async function readSnapshotArchivePayload(
  reference: SnapshotArchiveReference,
): Promise<Record<string, unknown> | null> {
  if (!reference.bucket || !reference.key) {
    return null;
  }

  const response = await getS3Client().send(
    new GetObjectCommand({
      Bucket: reference.bucket,
      Key: reference.key,
    }),
  );

  const raw = await bodyToString(response.Body);
  if (!raw) {
    return null;
  }

  return JSON.parse(raw) as Record<string, unknown>;
}
