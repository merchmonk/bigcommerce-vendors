import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getS3Client } from '../awsClients';

const DEFAULT_KEY_PREFIX = 'bigcommerce-remote-images';
const DEFAULT_PRESIGNED_TTL_SECONDS = 7200;
const MIN_WEBP_QUALITY = 30;
const QUALITY_STEP = 5;
const MAX_RESIZE_ROUNDS = 14;
const MIN_SHRINK_DIMENSION = 256;

sharp.cache(false);

/**
 * Re-encodes raster image bytes as WebP, reducing quality and dimensions until
 * the output is within maxBytes (BigCommerce remote image fetch limit).
 */
export async function encodeWebpUnderMaxBytes(
  imageBytes: Buffer,
  maxBytes: number,
): Promise<Buffer | null> {
  let working = imageBytes;

  for (let round = 0; round < MAX_RESIZE_ROUNDS; round++) {
    let quality = 70;
    while (quality >= MIN_WEBP_QUALITY) {
      const encoded = await sharp(working).webp({ quality, effort: 4 }).toBuffer();
      if (encoded.length <= maxBytes) {
        return encoded;
      }
      quality -= QUALITY_STEP;
    }

    const meta = await sharp(working).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      return null;
    }
    if (width <= MIN_SHRINK_DIMENSION && height <= MIN_SHRINK_DIMENSION) {
      return null;
    }

    const nextWidth = Math.max(1, Math.floor(width * 0.82));
    if (nextWidth >= width) {
      return null;
    }

    working = await sharp(working).resize({ width: nextWidth }).toBuffer();
  }

  return null;
}

/**
 * Writes WebP bytes to S3 and returns an HTTPS URL BigCommerce can GET without
 * AWS credentials: either a CDN/public URL prefix or a presigned GET URL.
 */
export async function stageWebpBufferForRemoteImageUrl(buffer: Buffer): Promise<string | null> {
  const bucket = process.env.BIGCOMMERCE_IMAGE_STAGING_BUCKET?.trim();
  if (!bucket) {
    return null;
  }
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  const prefix = process.env.BIGCOMMERCE_IMAGE_STAGING_KEY_PREFIX?.trim() || DEFAULT_KEY_PREFIX;
  const day = new Date().toISOString().slice(0, 10);
  const key = `${prefix}/${day}/${randomUUID()}.webp`;

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=86400',
    }),
  );

  const publicBase = process.env.BIGCOMMERCE_IMAGE_STAGING_PUBLIC_BASE_URL?.trim();
  if (publicBase) {
    const base = publicBase.replace(/\/$/, '');
    return `${base}/${key}`;
  }

  const ttlRaw = process.env.BIGCOMMERCE_IMAGE_STAGING_PRESIGNED_URL_TTL_SECONDS?.trim();
  const ttl = ttlRaw ? Number(ttlRaw) : DEFAULT_PRESIGNED_TTL_SECONDS;
  const expiresIn = Number.isFinite(ttl) && ttl > 60 ? ttl : DEFAULT_PRESIGNED_TTL_SECONDS;

  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn },
  );
}
