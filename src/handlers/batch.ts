import { eq } from 'drizzle-orm';
import { createDbClient, generateId } from '../db/client';
import {
  events,
  idempotencyKeys,
  projects,
  sessions,
  users,
} from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { getBotName, isBot } from '../utils/bot-detection';
import { logger } from '../utils/logger';
import {
  validateBatchSize,
  validateEventData,
  validateRequestSize,
} from '../utils/payload-limits';
import { validateTimestamp } from '../utils/timestamp-validation';
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

    // Log warnings if any
    if (requestSizeValidation.warnings.length > 0) {
      logger.warn(
        {
          warnings: requestSizeValidation.warnings,
        },
        'Request size warnings'
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

    // Check idempotency key to prevent duplicate processing
    if (validatedData.idempotencyKey) {
      const existingKey = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, validatedData.idempotencyKey))
        .get();

      if (existingKey) {
        logger.info(
          { idempotencyKey: validatedData.idempotencyKey },
          'Duplicate batch request detected (idempotency key already processed)'
        );
        // Return success response without processing (idempotent)
        return new Response(
          JSON.stringify({
            success: true,
            processed: existingKey.eventCount,
            failed: 0,
            duplicate: true, // Indicates this was a duplicate request
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }
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

    // Detect bot traffic based on user agent
    const userAgent =
      session.userAgent || request.headers.get('user-agent') || undefined;
    const botDetected = isBot(userAgent);

    if (botDetected) {
      const botName = getBotName(userAgent);
      logger.info(
        {
          sessionId: validatedData.sessionId,
          botName,
          userAgent,
        },
        'Bot traffic detected'
      );

      // Optional: Reject bot traffic (disabled by default to allow SEO monitoring)
      // Uncomment the following to reject bot requests:
      /*
      return new Response(
        JSON.stringify({
          success: false,
          errors: ['Bot traffic is not tracked'],
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
      */
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
        // Update last seen and event count
        await db
          .update(users)
          .set({
            lastSeen: new Date(),
            eventCount: existingUser.eventCount + validatedData.events.length,
          })
          .where(eq(users.id, existingUser.id))
          .run();
      } else {
        userId = generateId('user');
        await db
          .insert(users)
          .values({
            id: userId,
            projectId: project.id,
            anonymousId: validatedData.user.anonymousId,
            traits: validatedData.user.traits || {},
            eventCount: validatedData.events.length,
          })
          .run();
      }
    }

    // Process events in batch
    let processed = 0;
    let failed = 0;
    const errors: Array<{ index: number; error: string }> = [];

    let pageViewCount = 0;
    let interactionCount = 0;

    for (let i = 0; i < validatedData.events.length; i++) {
      const event = validatedData.events[i];
      try {
        // Validate timestamp to detect client clock skew
        const timestampValidation = validateTimestamp(event.timestamp, {
          maxFutureDrift: 60 * 1000, // 60 seconds
          maxPastAge: 24 * 60 * 60 * 1000, // 24 hours
          autoCorrect: true, // Auto-correct invalid timestamps to server time
        });

        if (!timestampValidation.isValid) {
          logger.warn(
            {
              index: i,
              eventType: event.type,
              clientTimestamp: event.timestamp,
              reason: timestampValidation.reason,
            },
            'Invalid event timestamp detected'
          );
        }

        // Use adjusted timestamp if validation failed and autoCorrect is enabled
        const finalTimestamp = timestampValidation.isValid
          ? event.timestamp
          : timestampValidation.adjustedTimestamp || Date.now();

        // Validate and truncate event data if needed
        const eventDataValidation = validateEventData(event.data);
        if (eventDataValidation.warnings.length > 0) {
          logger.warn(
            {
              index: i,
              eventType: event.type,
              warnings: eventDataValidation.warnings,
            },
            'Event data size warnings'
          );
        }

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
            referrer: event.referrer,
            timestamp: new Date(finalTimestamp),
            data: eventDataValidation.data,
          })
          .run();

        if (event.type === 'pageview') {
          pageViewCount++;
        } else {
          interactionCount++;
        }

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

    // Update session counts
    await db
      .update(sessions)
      .set({
        pageViews: session.pageViews + pageViewCount,
        interactions: session.interactions + interactionCount,
      })
      .where(eq(sessions.id, validatedData.sessionId))
      .run();

    // Store idempotency key to prevent duplicate processing
    if (validatedData.idempotencyKey) {
      try {
        await db
          .insert(idempotencyKeys)
          .values({
            key: validatedData.idempotencyKey,
            projectId: project.id,
            eventCount: processed,
          })
          .run();
        logger.info(
          { idempotencyKey: validatedData.idempotencyKey },
          'Stored idempotency key'
        );
      } catch (error) {
        // Log error but don't fail the request (events already processed)
        logger.error({ error }, 'Failed to store idempotency key');
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
