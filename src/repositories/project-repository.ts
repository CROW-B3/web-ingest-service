import type { DatabaseClient } from '../db/client';
import { eq } from 'drizzle-orm';
import { projects } from '../db/schema';

export async function findProjectByApiKey(
  database: DatabaseClient,
  apiKey: string
) {
  return database
    .select()
    .from(projects)
    .where(eq(projects.apiKey, apiKey))
    .get();
}
