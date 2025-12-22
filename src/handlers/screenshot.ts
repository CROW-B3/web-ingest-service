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
    const site = formData.get('site') as string;
    const hostname = formData.get('hostname') as string;
    const environment = formData.get('environment') as string;
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
    const r2Url = `https://web-ingest-worker.r2.cloudflarestorage.com/${r2Key}`;

    // Create date string (YYYY-MM-DD)
    const dateObj = new Date(Number.parseInt(timestamp));
    const date = dateObj.toISOString().split('T')[0];

    // Insert metadata into D1
    await env.DB.prepare(
      `INSERT INTO screenshots (
				r2_url,
				filename,
				site,
				hostname,
				environment,
				url,
				user_agent,
				viewport_width,
				viewport_height,
				scroll_x,
				scroll_y,
				file_size,
				timestamp,
				date
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        r2Url,
        filename,
        site,
        hostname,
        environment,
        url,
        userAgent,
        viewport.width,
        viewport.height,
        viewport.scrollX,
        viewport.scrollY,
        screenshot.size,
        Number.parseInt(timestamp),
        date
      )
      .run();

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
