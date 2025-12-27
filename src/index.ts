/**
 * Web Ingest Worker
 */

import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import { logger } from './utils/logger';

export default {
  async fetch(request, _env, _ctx): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const pathname = url.pathname;

    logger.info({ method, pathname, url: request.url }, 'Incoming request');

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      logger.debug('Handling CORS preflight request');
      return handleCorsPreFlight();
    }

    // Route: GET / - Health check
    if (pathname === '/' && method === 'GET') {
      logger.info('Health check request');
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'web-ingest-worker',
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
