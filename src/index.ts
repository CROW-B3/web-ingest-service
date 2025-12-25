/**
 * Web Ingest Worker - Handles screenshot uploads from website-hook-sdk
 *
 * - Receives screenshot uploads via POST /screenshots
 * - Stores images in R2 bucket
 * - Saves metadata (R2 URL, timestamp, etc.) in D1 database
 * - Handles pointer coordinate tracking via POST /pointer-data
 */

import { handlePointerDataUpload } from './handlers/pointer-data';
import { handleScreenshotUpload } from './handlers/screenshot';
import {
  addCorsHeaders,
  corsHeaders,
  handleCorsPreFlight,
} from './middleware/cors';
import { logger } from './utils/logger';

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    logger.info({ method, pathname, url: request.url }, 'Incoming request');

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      logger.debug('Handling CORS preflight request');
      return handleCorsPreFlight();
    }

    // Route: POST /screenshots - Handle screenshot uploads
    if (pathname === '/screenshots' && method === 'POST') {
      logger.info('Handling screenshot upload request');
      const response = await handleScreenshotUpload(request, env);
      return addCorsHeaders(response);
    }

    // Route: POST /pointer-data - Handle pointer coordinate batches
    if (pathname === '/pointer-data' && method === 'POST') {
      logger.info('Handling pointer data upload request');
      const response = await handlePointerDataUpload(request, env);
      return addCorsHeaders(response);
    }

    // Route: GET / - Health check
    if (pathname === '/' && method === 'GET') {
      logger.info('Health check request');
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'web-ingest-worker',
          endpoints: [
            {
              path: '/screenshots',
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
    logger.warn({ method, pathname }, 'Route not found');
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
