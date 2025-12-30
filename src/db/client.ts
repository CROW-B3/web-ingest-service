import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * Create a Drizzle database instance from D1 binding
 */
export function createDbClient(d1: D1Database) {
  return drizzle(d1, { schema });
}

/**
 * Generate a unique ID with timestamp and random string
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}${randomStr}`;
}

/**
 * Get current timestamp in seconds (Unix epoch)
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
