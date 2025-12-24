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
import { handleUnifiedInteractionUpload } from './handlers/unified-interaction';
import {
  addCorsHeaders,
  corsHeaders,
  handleCorsPreFlight,
} from './middleware/cors';

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCorsPreFlight();
    }

    // Route: POST /interaction-batch - Handle unified interaction batches (screenshots + pointer data)
    if (url.pathname === '/interaction-batch' && request.method === 'POST') {
      const response = await handleUnifiedInteractionUpload(request, env);
      return addCorsHeaders(response);
    }

    // Route: POST /screenshots - Handle screenshot uploads (legacy, for backward compatibility)
    if (url.pathname === '/screenshots' && request.method === 'POST') {
      const response = await handleScreenshotUpload(request, env);
      return addCorsHeaders(response);
    }

    // Route: POST /pointer-data - Handle pointer coordinate batches (legacy, for backward compatibility)
    if (url.pathname === '/pointer-data' && request.method === 'POST') {
      const response = await handlePointerDataUpload(request, env);
      return addCorsHeaders(response);
    }

    // Route: GET / - Health check
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'web-ingest-worker',
          endpoints: [
            {
              path: '/interaction-batch',
              method: 'POST',
              description:
                'Upload unified interaction batch (screenshots + pointer data)',
            },
            {
              path: '/screenshots',
              method: 'POST',
              description: 'Upload screenshot (legacy)',
            },
            {
              path: '/pointer-data',
              method: 'POST',
              description: 'Upload pointer coordinate batch (legacy)',
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
