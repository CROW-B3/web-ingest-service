import type { DatabaseClient } from '../db/client';
import { asc, eq } from 'drizzle-orm';
import { generateId } from '../db/client';
import { events } from '../db/schema';

interface TrackingEventData {
  type: string;
  url: string;
  timestamp: number;
  referrer?: string;
  data?: Record<string, unknown>;
}

export async function findEventsBySessionId(
  database: DatabaseClient,
  sessionId: string
) {
  return database
    .select()
    .from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(asc(events.timestamp))
    .all();
}

export async function insertTrackingEvent(
  database: DatabaseClient,
  sessionId: string,
  eventData: TrackingEventData
): Promise<string> {
  const eventId = generateId('evt');
  await database
    .insert(events)
    .values({
      id: eventId,
      sessionId,
      type: eventData.type,
      url: eventData.url,
      timestamp: eventData.timestamp,
      data: eventData.data || {},
    })
    .run();
  return eventId;
}
