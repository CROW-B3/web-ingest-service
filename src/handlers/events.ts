import { createDatabaseClient } from '../db/client';
import { events } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { eq, asc } from 'drizzle-orm';
import { logger } from '../utils/logger';

interface SessionEvent {
  id: string;
  type: string;
  url: string;
  timestamp: number;
  data?: Record<string, any>;
}

function createErrorResponse(
  errorMessage: string,
  statusCode: number
): Response {
  return new Response(
    JSON.stringify({ success: false, errors: [errorMessage] }),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function createSuccessResponse(eventsList: SessionEvent[]): Response {
  return new Response(
    JSON.stringify({
      success: true,
      events: eventsList,
      count: eventsList.length,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

export async function handleGetSessionEvents(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    // Extract sessionId from URL
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      logger.warn('Missing sessionId parameter');
      return createErrorResponse('Missing sessionId parameter', 400);
    }

    logger.info({ sessionId }, 'Fetching events for session');

    const database = createDatabaseClient(environment.DB);

    // Fetch events from D1
    const eventsList = await database
      .select({
        id: events.id,
        type: events.type,
        url: events.url,
        timestamp: events.timestamp,
        data: events.data,
      })
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(asc(events.timestamp));

    const formattedEvents: SessionEvent[] = eventsList.map(event => ({
      id: event.id,
      type: event.type,
      url: event.url,
      timestamp: event.timestamp as any as number,
      data: event.data || undefined,
    }));

    logger.info(
      { sessionId, eventCount: formattedEvents.length },
      'Successfully fetched session events'
    );

    return createSuccessResponse(formattedEvents);
  } catch (error) {
    logger.error({ error }, 'Error fetching session events');
    return createErrorResponse('Internal server error', 500);
  }
}
