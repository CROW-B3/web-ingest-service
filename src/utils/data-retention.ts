/**
 * Data Retention Policy Utility
 * Handles automatic cleanup of old data based on retention policies
 */

import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { lt } from 'drizzle-orm';
import { events, idempotencyKeys, sessions } from '../db/schema';
import { logger } from './logger';

export interface RetentionPolicy {
  eventsRetentionDays: number; // Default: 90 days
  sessionsRetentionDays: number; // Default: 180 days
  idempotencyKeysRetentionDays: number; // Default: 7 days
}

export interface CleanupResult {
  eventsDeleted: number;
  sessionsDeleted: number;
  idempotencyKeysDeleted: number;
  durationMs: number;
}

/**
 * Default retention policy
 */
export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  eventsRetentionDays: 90,
  sessionsRetentionDays: 180,
  idempotencyKeysRetentionDays: 7,
};

/**
 * Calculate cutoff timestamp for retention
 */
function getCutoffTimestamp(retentionDays: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  return cutoff;
}

/**
 * Clean up old events based on retention policy
 */
async function cleanupEvents(
  db: DrizzleD1Database<any>,
  retentionDays: number
): Promise<number> {
  const cutoff = getCutoffTimestamp(retentionDays);

  try {
    const result = await db
      .delete(events)
      .where(lt(events.timestamp, cutoff))
      .run();

    return result.changes || 0;
  } catch (error) {
    logger.error({ error }, 'Error cleaning up events');
    throw error;
  }
}

/**
 * Clean up old sessions based on retention policy
 */
async function cleanupSessions(
  db: DrizzleD1Database<any>,
  retentionDays: number
): Promise<number> {
  const cutoff = getCutoffTimestamp(retentionDays);

  try {
    const result = await db
      .delete(sessions)
      .where(lt(sessions.startedAt, cutoff))
      .run();

    return result.changes || 0;
  } catch (error) {
    logger.error({ error }, 'Error cleaning up sessions');
    throw error;
  }
}

/**
 * Clean up old idempotency keys based on retention policy
 */
async function cleanupIdempotencyKeys(
  db: DrizzleD1Database<any>,
  retentionDays: number
): Promise<number> {
  const cutoff = getCutoffTimestamp(retentionDays);

  try {
    const result = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.processedAt, cutoff))
      .run();

    return result.changes || 0;
  } catch (error) {
    logger.error({ error }, 'Error cleaning up idempotency keys');
    throw error;
  }
}

/**
 * Execute data retention cleanup based on policy
 * @param db - Database client
 * @param policy - Retention policy (optional, uses defaults if not provided)
 * @returns Cleanup results
 */
export async function executeRetentionPolicy(
  db: DrizzleD1Database<any>,
  policy: Partial<RetentionPolicy> = {}
): Promise<CleanupResult> {
  const startTime = Date.now();

  const finalPolicy: RetentionPolicy = {
    ...DEFAULT_RETENTION_POLICY,
    ...policy,
  };

  logger.info(
    {
      policy: finalPolicy,
    },
    'Starting data retention cleanup'
  );

  try {
    // Run cleanups in parallel for better performance
    const [eventsDeleted, sessionsDeleted, idempotencyKeysDeleted] =
      await Promise.all([
        cleanupEvents(db, finalPolicy.eventsRetentionDays),
        cleanupSessions(db, finalPolicy.sessionsRetentionDays),
        cleanupIdempotencyKeys(db, finalPolicy.idempotencyKeysRetentionDays),
      ]);

    const durationMs = Date.now() - startTime;

    const result: CleanupResult = {
      eventsDeleted,
      sessionsDeleted,
      idempotencyKeysDeleted,
      durationMs,
    };

    logger.info(result, 'Data retention cleanup completed');

    return result;
  } catch (error) {
    logger.error({ error }, 'Data retention cleanup failed');
    throw error;
  }
}
