import { eq } from 'drizzle-orm';
import { createDbClient, generateId } from '../db/client';
import { projects, sessions, users } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import {
  sessionEndRequestSchema,
  sessionStartRequestSchema,
} from '../validation/schemas';

/**
 * Handle POST /session/start - Start a new session
 */
export async function handleSessionStart(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = sessionStartRequestSchema.parse(body);

    logger.info(
      {
        projectId: validatedData.projectId,
        sessionId: validatedData.sessionId,
      },
      'Session start request'
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

    // Get or create user
    let userId: string | null = null;
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.anonymousId, validatedData.user.anonymousId))
      .get();

    if (existingUser) {
      userId = existingUser.id;
      // Update session count
      await db
        .update(users)
        .set({
          sessionCount: existingUser.sessionCount + 1,
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
          sessionCount: 1,
        })
        .run();
    }

    // Parse user agent for device/browser info
    const userAgent = validatedData.context.userAgent;
    const deviceType = getDeviceType(userAgent);
    const browser = getBrowser(userAgent);
    const os = getOS(userAgent);

    // Extract IP from request (Cloudflare provides this)
    const ipAddress = request.headers.get('CF-Connecting-IP') || 'unknown';
    const country = request.headers.get('CF-IPCountry') || undefined;

    // Create session
    await db
      .insert(sessions)
      .values({
        id: validatedData.sessionId,
        projectId: project.id,
        userId: validatedData.user.id || userId,
        anonymousId: validatedData.user.anonymousId,
        initialUrl: validatedData.context.url,
        referrer: validatedData.context.referrer,
        userAgent,
        ipAddress,
        country,
        deviceType,
        browser,
        os,
      })
      .run();

    // Session expires in 30 minutes by default
    const expiresAt = Date.now() + 30 * 60 * 1000;

    logger.info({ sessionId: validatedData.sessionId }, 'Session started');

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: validatedData.sessionId,
        expiresAt,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error starting session');

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

/**
 * Handle POST /session/end - End a session
 */
export async function handleSessionEnd(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse and validate request body
    const body = await request.json();
    const validatedData = sessionEndRequestSchema.parse(body);

    logger.info(
      {
        projectId: validatedData.projectId,
        sessionId: validatedData.sessionId,
      },
      'Session end request'
    );

    const db = createDbClient(env.DB);

    // Verify project exists
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

    // Update session with end data
    await db
      .update(sessions)
      .set({
        endedAt: new Date(),
        duration: validatedData.duration,
      })
      .where(eq(sessions.id, validatedData.sessionId))
      .run();

    logger.info({ sessionId: validatedData.sessionId }, 'Session ended');

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error ending session');

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

// Helper functions for user agent parsing
function getDeviceType(userAgent: string): string {
  if (/mobile/i.test(userAgent)) return 'mobile';
  if (/tablet/i.test(userAgent)) return 'tablet';
  return 'desktop';
}

function getBrowser(userAgent: string): string {
  if (/chrome/i.test(userAgent)) return 'Chrome';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/edge/i.test(userAgent)) return 'Edge';
  return 'Unknown';
}

function getOS(userAgent: string): string {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  if (/android/i.test(userAgent)) return 'Android';
  if (/ios/i.test(userAgent)) return 'iOS';
  return 'Unknown';
}
