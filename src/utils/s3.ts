import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { logger } from './logger';

/**
 * Create an S3 client configured for Cloudflare R2
 */
export function createS3Client(env: Env): S3Client {
  logger.debug(
    { endpoint: env.R2_ENDPOINT, bucket: env.R2_BUCKET_NAME },
    'Creating S3 client for R2'
  );

  return new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  });
}

export interface UploadFileOptions {
  key: string;
  file: File;
  metadata?: Record<string, string>;
}

/**
 * Upload a file to R2 using S3-compatible API
 */
export async function uploadToR2(
  s3Client: S3Client,
  env: Env,
  options: UploadFileOptions
): Promise<string> {
  const { key, file, metadata } = options;

  logger.debug(
    {
      key,
      fileSize: file.size,
      contentType: file.type,
      metadata,
    },
    'Starting R2 upload'
  );

  // Convert File to ArrayBuffer for upload
  const arrayBuffer = await file.arrayBuffer();

  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: key,
    Body: new Uint8Array(arrayBuffer),
    ContentType: file.type,
    Metadata: metadata,
  });

  await s3Client.send(command);

  const publicUrl = `${env.R2_PUBLIC_URL}/${key}`;
  logger.info({ key, publicUrl }, 'Successfully uploaded to R2');

  // Return the public URL
  return publicUrl;
}
