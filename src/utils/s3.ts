import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Create an S3 client configured for Cloudflare R2
 */
export function createS3Client(env: Env): S3Client {
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

  // Return the public URL
  return `${env.R2_PUBLIC_URL}/${key}`;
}
