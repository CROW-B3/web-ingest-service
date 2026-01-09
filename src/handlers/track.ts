import { eq } from 'drizzle-orm';
import { createDbClient, generateId } from '../db/client';
import { events, projects, sessions, users } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import { trackRequestSchema } from '../validation/schemas';

/**
 * Handle POST /track - Single event tracking
 */
export async function handleTrack(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = trackRequestSchema.parse(body);

    logger.info({ projectId: validatedData.projectId }, 'Track event request');

    const db = createDbClient(env.DB);

    // Verify project exists and API key is valid
    const project = await db
      .select()
      .from(projects)
      .where(eq(projects.apiKey, validatedData.projectId))
      .get();

    if (!project) {
      logger.warn({ projectId: validatedData.projectId }, 'Invalid project ID');
      return new Response(
        JSON.stringify({ success: false, errors: ['Invalid project ID'] }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Check if session exists
    const session = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, validatedData.sessionId))
      .get();

    if (!session) {
      logger.warn({ sessionId: validatedData.sessionId }, 'Session not found');
      return new Response(
        JSON.stringify({
          success: false,
          errors: ['Session not found. Please start a session first.'],
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Get or create user
    let userId: string | null = null;
    if (validatedData.user) {
      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.anonymousId, validatedData.user.anonymousId))
        .get();

      if (existingUser) {
        userId = existingUser.id;
      } else {
        userId = generateId('user');
        await db
          .insert(users)
          .values({
            id: userId,
            projectId: project.id,
            anonymousId: validatedData.user.anonymousId,
          })
          .run();
      }
    }

    // Insert event
    const eventId = generateId('evt');
    await db
      .insert(events)
      .values({
        id: eventId,
        projectId: project.id,
        sessionId: validatedData.sessionId,
        userId,
        anonymousId: validatedData.user?.anonymousId || 'unknown',
        type: validatedData.event.type,
        url: validatedData.event.url,
        timestamp: new Date(validatedData.event.timestamp),
        data: validatedData.event.data || {},
      })
      .run();

    logger.info({ eventId, type: validatedData.event.type }, 'Event tracked');

    return new Response(
      JSON.stringify({
        success: true,
        eventId,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error tracking event');

    if (error instanceof Error && error.name === 'ZodError') {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [(error as any).errors],
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        errors: ['Internal server error'],
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}
