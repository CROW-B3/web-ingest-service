import { DurableObject } from 'cloudflare:workers';

/**
 * Web Ingest Worker - Handles screenshot uploads from website-hook-sdk
 *
 * - Receives screenshot uploads via POST /screenshot
 * - Stores images in R2 bucket
 * - Saves metadata (R2 URL, timestamp, etc.) in D1 database
 */

/**
 * Pointer coordinate data point
 */
interface PointerCoordinate {
  timestamp: number;
  clientX: number;
  clientY: number;
  pageX: number;
  pageY: number;
  pointerType: string;
  pressure: number;
  pointerId: number;
}

/**
 * Batch of pointer coordinates from SDK
 */
interface PointerCoordinateBatch {
  sessionId: string;
  coordinates: PointerCoordinate[];
  batchStartTime: number;
  batchEndTime: number;
  url: string;
  site?: string;
  hostname?: string;
  environment?: string;
}

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject<Env> {
  /**
   * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
   * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
   *
   * @param ctx - The interface for interacting with Durable Object state
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   */
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  /**
   * The Durable Object exposes an RPC method sayHello which will be invoked when when a Durable
   *  Object instance receives a request from a Worker via the same method invocation on the stub
   *
   * @param name - The name provided to a Durable Object instance from a Worker
   * @returns The greeting to be sent back to the Worker
   */
  async sayHello(name: string): Promise<string> {
    return `Hello, ${name}!`;
  }
}

/**
 * Handle pointer coordinate batch upload
 */
async function handlePointerDataUpload(
  request: Request,
  _env: Env
): Promise<Response> {
  try {
    // Parse JSON body
    const batch = (await request.json()) as PointerCoordinateBatch;

    // Console.warn for testing
    console.warn('[PointerData] Received batch:', {
      sessionId: batch.sessionId,
      coordinateCount: batch.coordinates?.length || 0,
      batchStartTime: batch.batchStartTime,
      batchEndTime: batch.batchEndTime,
      duration: `${batch.batchEndTime - batch.batchStartTime}ms`,
      url: batch.url,
      site: batch.site,
      hostname: batch.hostname,
      environment: batch.environment,
    });

    // Log first and last coordinates
    if (batch.coordinates && batch.coordinates.length > 0) {
      console.warn('[PointerData] First coordinate:', batch.coordinates[0]);
      console.warn(
        '[PointerData] Last coordinate:',
        batch.coordinates[batch.coordinates.length - 1]
      );

      // Log some sample coordinates in the middle
      if (batch.coordinates.length > 10) {
        const middleIndex = Math.floor(batch.coordinates.length / 2);
        console.warn(
          '[PointerData] Middle coordinates (sample):',
          batch.coordinates.slice(middleIndex - 2, middleIndex + 3)
        );
      }
    }

    // TODO: Store in D1 database (for future implementation)
    // For now, just return success with the data we received

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: batch.sessionId,
        coordinatesReceived: batch.coordinates?.length || 0,
        batchDuration: batch.batchEndTime - batch.batchStartTime,
        message: 'Pointer data received and logged successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[PointerData] Error processing pointer data:', error);
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

/**
 * Handle screenshot upload requests
 */
async function handleScreenshotUpload(
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

export default {
  /**
   * This is the standard fetch handler for a Cloudflare Worker
   *
   * @param request - The request submitted to the Worker from the client
   * @param env - The interface to reference bindings declared in wrangler.jsonc
   * @param _ctx - The execution context of the Worker
   * @returns The response to be sent back to the client
   */
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    // CORS headers for local development
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Route: POST /screenshot - Handle screenshot uploads
    if (url.pathname === '/screenshot' && request.method === 'POST') {
      const response = await handleScreenshotUpload(request, env);
      // Add CORS headers to response
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }

    // Route: POST /pointer-data - Handle pointer coordinate batches
    if (url.pathname === '/pointer-data' && request.method === 'POST') {
      const response = await handlePointerDataUpload(request, env);
      // Add CORS headers to response
      Object.entries(corsHeaders).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
      return response;
    }

    // Route: GET / - Health check
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'web-ingest-worker',
          endpoints: [
            {
              path: '/screenshot',
              method: 'POST',
              description: 'Upload screenshot',
            },
            {
              path: '/pointer-data',
              method: 'POST',
              description: 'Upload pointer coordinate batch',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // 404 for unknown routes
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
