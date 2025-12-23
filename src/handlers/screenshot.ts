import { drizzle } from 'drizzle-orm/d1';
import { screenshots } from '../db/schema';

/**
 * Handle screenshot upload requests
 */
export async function handleScreenshotUpload(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse FormData
    const formData = await request.formData();

    // Get screenshot file
    const screenshot = formData.get('screenshot');
    if (!screenshot || !(screenshot instanceof File)) {
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
    const r2Key = `test/${timestamp}-${filename}`;

    // Upload to R2
    await env.BUCKET.put(r2Key, screenshot, {
      httpMetadata: {
        contentType: screenshot.type,
      },
      customMetadata: {
        originalFilename: filename,
        uploadTimestamp: timestamp,
        url,
        site,
      },
    });

    // Generate R2 URL (for D1 storage)
    // In production, you'd use your actual R2 public URL or custom domain
    const r2Url = `https://pub-150ee81a748a4f14bdd27c39a7eaf0a5.r2.dev/${r2Key}`;

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

    console.warn('Screenshot uploaded successfully:', {
      r2Key,
      filename,
      size: screenshot.size,
      timestamp,
      site,
      date,
    });

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
    console.error('Error uploading screenshot:', error);
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
