import { eq } from 'drizzle-orm';
import { createDbClient, generateId } from '../db/client';
import { events, projects, sessions, users } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import {
  validateBatchSize,
  validateRequestSize,
} from '../utils/payload-limits';
import { batchRequestSchema } from '../validation/schemas';

/**
 * Handle POST /batch - Batch event tracking
 */
export async function handleBatch(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse and validate request body
    const body = await request.json();

    // Validate request size before processing
    const requestSizeValidation = validateRequestSize(body);
    if (!requestSizeValidation.isValid) {
      logger.warn(
        {
          errors: requestSizeValidation.errors,
        },
        'Request size validation failed'
      );
      return new Response(
        JSON.stringify({
          success: false,
          errors: requestSizeValidation.errors,
        }),
        {
          status: 413, // Payload Too Large
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    const validatedData = batchRequestSchema.parse(body);

    // Validate batch size
    const batchSizeValidation = validateBatchSize(validatedData.events.length);
    if (!batchSizeValidation.isValid) {
      logger.warn(
        {
          eventCount: validatedData.events.length,
          errors: batchSizeValidation.errors,
        },
        'Batch size validation failed'
      );
      return new Response(
        JSON.stringify({
          success: false,
          errors: batchSizeValidation.errors,
        }),
        {
          status: 413, // Payload Too Large
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    logger.info(
      {
        projectId: validatedData.projectId,
        eventCount: validatedData.events.length,
      },
      'Batch event request'
    );

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

    // Process events in batch
    let processed = 0;
    let failed = 0;
    const errors: Array<{ index: number; error: string }> = [];

    for (let i = 0; i < validatedData.events.length; i++) {
      const event = validatedData.events[i];
      try {
        const eventId = generateId('evt');
        await db
          .insert(events)
          .values({
            id: eventId,
            projectId: project.id,
            sessionId: validatedData.sessionId,
            userId,
            anonymousId: validatedData.user?.anonymousId || 'unknown',
            type: event.type,
            url: event.url,
            timestamp: new Date(event.timestamp),
            data: event.data,
          })
          .run();

        processed++;
      } catch (error) {
        logger.error({ error, index: i }, 'Error processing event in batch');
        failed++;
        errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info({ processed, failed }, 'Batch processing complete');

    return new Response(
      JSON.stringify({
        success: failed === 0,
        processed,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error processing batch');

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
