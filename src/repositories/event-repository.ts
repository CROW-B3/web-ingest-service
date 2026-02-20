import type { DatabaseClient } from '../db/client';
import { generateId } from '../db/client';
import { events } from '../db/schema';

interface TrackingEventData {
  type: string;
  url: string;
  timestamp: number;
  referrer?: string;
  data?: Record<string, unknown>;
}

export async function insertTrackingEvent(
  database: DatabaseClient,
  projectId: string,
  sessionId: string,
  userId: string | null,
  anonymousId: string,
  eventData: TrackingEventData
): Promise<string> {
  const eventId = generateId('evt');
  await database
    .insert(events)
    .values({
      id: eventId,
      projectId,
      sessionId,
      userId,
      anonymousId,
      type: eventData.type,
      url: eventData.url,
      timestamp: eventData.timestamp,
      data: eventData.data || {},
    })
    .run();
  return eventId;
}
