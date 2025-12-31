/**
 * Data Retention Cleanup Handler
 * Endpoint for executing data retention policy cleanup
 * Should be called periodically via Cloudflare Cron Triggers
 */

import type { RetentionPolicy } from '../utils/data-retention';
import { createDbClient } from '../db/client';
import { corsHeaders } from '../middleware/cors';
import { executeRetentionPolicy } from '../utils/data-retention';
import { logger } from '../utils/logger';

/**
 * Handle GET /cleanup - Execute data retention cleanup
 * This endpoint should be protected (e.g., require admin API key)
 * and called via Cloudflare Cron Triggers
 */
export async function handleCleanup(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Optional: Check for admin authorization
    const authHeader = request.headers.get('authorization');
    const expectedToken = env.ADMIN_API_KEY || 'admin-secret-key'; // Configure in wrangler.toml

    if (authHeader !== `Bearer ${expectedToken}`) {
      logger.warn('Unauthorized cleanup attempt');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    const db = createDbClient(env.DB);

    // Parse optional retention policy from query params
    const url = new URL(request.url);
    const customPolicy: Partial<RetentionPolicy> = {};

    const eventsRetention = url.searchParams.get('eventsRetentionDays');
    if (eventsRetention) {
      customPolicy.eventsRetentionDays = Number.parseInt(eventsRetention, 10);
    }

    const sessionsRetention = url.searchParams.get('sessionsRetentionDays');
    if (sessionsRetention) {
      customPolicy.sessionsRetentionDays = Number.parseInt(
        sessionsRetention,
        10
      );
    }

    const idempotencyRetention = url.searchParams.get(
      'idempotencyKeysRetentionDays'
    );
    if (idempotencyRetention) {
      customPolicy.idempotencyKeysRetentionDays = Number.parseInt(
        idempotencyRetention,
        10
      );
    }

    // Execute cleanup
    const result = await executeRetentionPolicy(db, customPolicy);

    return new Response(
      JSON.stringify({
        success: true,
        result,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error executing cleanup');

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

/**
 * Handle Cloudflare Cron Trigger
 * This function is called automatically by Cloudflare Workers cron triggers
 */
export async function handleScheduledCleanup(env: Env): Promise<void> {
  try {
    logger.info('Starting scheduled data retention cleanup');

    const db = createDbClient(env.DB);
    const result = await executeRetentionPolicy(db);

    logger.info(
      { result },
      'Scheduled data retention cleanup completed successfully'
    );
  } catch (error) {
    logger.error({ error }, 'Scheduled data retention cleanup failed');
    // Don't throw - we don't want to fail the cron job
  }
}
