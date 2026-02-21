import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function createDatabaseClient(databaseBinding: D1Database) {
  return drizzle(databaseBinding, { schema });
}

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const randomString = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}${randomString}`;
}

export function getCurrentTimestampInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
