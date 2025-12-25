import { drizzle } from 'drizzle-orm/d1';
import { screenshots } from '../db/schema';
import { logger } from '../utils/logger';
import { createS3Client, uploadToR2 } from '../utils/s3';

/**
 * Handle screenshot upload requests
 */
export async function handleScreenshotUpload(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    logger.info('Starting screenshot upload processing');
    // Parse FormData
    const formData = await request.formData();

    // Get screenshot file
    const screenshot = formData.get('screenshot');
    if (!screenshot || !(screenshot instanceof File)) {
      logger.warn('No screenshot file provided in request');
      return new Response(
        JSON.stringify({ success: false, error: 'No screenshot provided' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get metadata
    const filename = formData.get('filename') as string;
    const timestamp = formData.get('timestamp') as string;
    const url = formData.get('url') as string;
    const userAgent = formData.get('userAgent') as string;

    // Provide defaults for NOT NULL fields
    const site = (formData.get('site') as string) || 'unknown';
    const hostname = (formData.get('hostname') as string) || 'unknown';
    const environment = (formData.get('environment') as string) || 'production';

    const viewport = JSON.parse((formData.get('viewport') as string) || '{}');

    // Generate R2 key with timestamp and filename
    const r2Key = `${env.R2_UPLOAD_PREFIX}/${timestamp}-${filename}`;

    logger.debug({ r2Key, filename, size: screenshot.size }, 'Uploading to R2');

    // Initialize S3 client and upload to R2
    const s3Client = createS3Client(env);
    const r2Url = await uploadToR2(s3Client, env, {
      key: r2Key,
      file: screenshot,
      metadata: {
        originalFilename: filename,
        uploadTimestamp: timestamp,
        url,
        site,
      },
    });

    logger.info({ r2Key, r2Url }, 'Successfully uploaded to R2');

    // Create date string (YYYY-MM-DD)
    const dateObj = new Date(Number.parseInt(timestamp));
    const date = dateObj.toISOString().split('T')[0];

    // Insert metadata into D1 using Drizzle
    const db = drizzle(env.DB);
    await db.insert(screenshots).values({
      r2Url,
      filename,
      site,
      hostname,
      environment,
      url,
      userAgent,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      fileSize: screenshot.size,
      timestamp: Number.parseInt(timestamp),
      date,
    });

    logger.info(
      {
        r2Key,
        filename,
        size: screenshot.size,
        timestamp,
        site,
        date,
      },
      'Screenshot metadata saved to D1'
    );

    return new Response(
      JSON.stringify({
        success: true,
        r2Key,
        r2Url,
        filename,
        size: screenshot.size,
        timestamp,
        date,
        message: 'Screenshot uploaded to R2 and metadata saved to D1',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      'Error uploading screenshot'
    );
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
