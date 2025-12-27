/**
 * Web Ingest Worker
 */

import { DurableObject } from 'cloudflare:workers';
import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import { logger } from './utils/logger';

/** A Durable Object's behavior is defined in an exported Javascript class */
export class CrowWebSession extends DurableObject<Env> {
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

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// Create a stub to open a communication channel with the Durable Object
		// instance named "foo".
		//
		// Requests from all Workers to the Durable Object instance named "foo"
		// will go to a single remote Durable Object instance.
		const stub = env.CROW_WEB_SESSION.getByName('foo');
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
