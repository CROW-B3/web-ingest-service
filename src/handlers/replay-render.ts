import puppeteer from '@cloudflare/puppeteer';
import { asc, eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import {
  projects,
  replayChunks,
  replayScreenshots,
  sessions,
} from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import { replayRenderRequestSchema } from '../validation/schemas';

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

function createValidationErrorResponse(validationErrors: any): Response {
  return new Response(
    JSON.stringify({
      success: false,
      errors: [validationErrors],
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

async function findProjectByApiKey(database: any, apiKey: string) {
  return database
    .select()
    .from(projects)
    .where(eq(projects.apiKey, apiKey))
    .get();
}

async function findSessionById(database: any, sessionId: string) {
  return database
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
}

async function fetchAllReplayChunks(database: any, sessionId: string) {
  return database
    .select()
    .from(replayChunks)
    .where(eq(replayChunks.sessionId, sessionId))
    .orderBy(asc(replayChunks.chunkIndex))
    .all();
}

async function reassembleReplayEvents(
  r2Bucket: R2Bucket,
  chunks: any[]
): Promise<any[]> {
  const allEvents: any[] = [];

  for (const chunk of chunks) {
    const object = await r2Bucket.get(chunk.r2Key);
    if (!object) {
      logger.warn({ r2Key: chunk.r2Key }, 'Replay chunk not found in R2');
      continue;
    }

    const text = await object.text();
    const events = JSON.parse(text);
    allEvents.push(...events);
  }

  return allEvents;
}

interface KeyMoment {
  timestamp: number;
  offsetMs: number;
  eventType: string;
  description: string;
  clickData?: {
    x: number;
    y: number;
    interactionType: number;
  };
}

function detectKeyMoments(events: any[]): KeyMoment[] {
  if (events.length === 0) return [];

  const firstTimestamp = events[0].timestamp ?? 0;
  const moments: KeyMoment[] = [];
  const seenTimestamps = new Set<number>();

  function addMoment(moment: KeyMoment): void {
    if (seenTimestamps.has(moment.timestamp)) return;
    seenTimestamps.add(moment.timestamp);
    moments.push(moment);
  }

  // Always include the first event (initial page state)
  addMoment({
    timestamp: firstTimestamp,
    offsetMs: 0,
    eventType: 'session_start',
    description: 'Session started - initial page state',
  });

  for (const event of events) {
    const ts = event.timestamp ?? 0;
    const offsetMs = ts - firstTimestamp;

    // rrweb event type 2 = FullSnapshot (page load / navigation)
    if (event.type === 2) {
      addMoment({
        timestamp: ts,
        offsetMs,
        eventType: 'full_snapshot',
        description: 'Page loaded - full DOM snapshot',
      });
    }

    // rrweb event type 3 = IncrementalSnapshot
    if (event.type === 3 && event.data) {
      // source 2 = MouseInteraction (click, dblclick, etc.)
      if (event.data.source === 2) {
        const interactionTypes: Record<number, string> = {
          0: 'mouseup',
          1: 'mousedown',
          2: 'click',
          3: 'contextmenu',
          4: 'dblclick',
          5: 'focus',
          6: 'blur',
          7: 'touchstart',
          8: 'touchmove_departed',
          9: 'touchend',
        };
        const interactionType = event.data.type ?? 2;
        const typeName = interactionTypes[interactionType] || 'interaction';

        // Only capture clicks, not mouseup/mousedown etc
        if (interactionType === 2 || interactionType === 4) {
          addMoment({
            timestamp: ts,
            offsetMs,
            eventType: typeName,
            description: `User ${typeName} at (${event.data.x}, ${event.data.y})`,
            clickData: {
              x: event.data.x,
              y: event.data.y,
              interactionType,
            },
          });
        }
      }

      // source 0 = Mutation (significant DOM changes)
      // We don't screenshot every mutation - too noisy
    }

    // rrweb event type 4 = Meta (viewport changes)
    if (event.type === 4) {
      addMoment({
        timestamp: ts,
        offsetMs,
        eventType: 'viewport_change',
        description: `Viewport changed to ${event.data?.width}x${event.data?.height}`,
      });
    }
  }

  // Always include the last event
  const lastEvent = events[events.length - 1];
  const lastTs = lastEvent.timestamp ?? 0;
  addMoment({
    timestamp: lastTs,
    offsetMs: lastTs - firstTimestamp,
    eventType: 'session_end',
    description: 'Last recorded state',
  });

  return moments.sort((a, b) => a.timestamp - b.timestamp);
}

function getSessionViewport(events: any[]): { width: number; height: number } {
  // rrweb type 4 = Meta event which contains viewport dimensions
  for (const event of events) {
    if (event.type === 4 && event.data) {
      return {
        width: event.data.width || 1280,
        height: event.data.height || 720,
      };
    }
  }
  return { width: 1280, height: 720 };
}

function buildReplayHtml(
  events: any[],
  viewport: { width: number; height: number }
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; }
    .rr-player { margin: 0 !important; }
    .replayer-wrapper { margin: 0 !important; }
  </style>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.17/dist/style.css" />
</head>
<body>
  <div id="player"></div>
  <script src="https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.17/dist/index.js"></script>
  <script>
    const events = ${JSON.stringify(events)};
    const player = new rrwebPlayer({
      target: document.getElementById('player'),
      props: {
        events,
        showController: false,
        autoPlay: false,
        width: ${viewport.width},
        height: ${viewport.height},
        skipInactive: false,
      },
    });
    window.__rrwebPlayer = player;
    window.__firstTimestamp = events.length > 0 ? events[0].timestamp : 0;
    window.__renderReady = true;
  </script>
</body>
</html>`;
}

export interface ScreenshotResult {
  timestamp: number;
  offsetMs: number;
  eventType: string;
  description: string;
  r2Key: string;
  url: string;
  clickPosition?: { x: number; y: number };
}

export interface RenderResult {
  success: boolean;
  viewport?: { width: number; height: number };
  screenshots: ScreenshotResult[];
  error?: string;
}

export const MAX_KEY_MOMENTS_FOR_QUEUE = 20;

export async function renderScreenshotsForSession(
  env: Env,
  projectId: string,
  sessionId: string,
  requestedTimestamps?: number[],
  maxMoments?: number
): Promise<RenderResult> {
  const database = createDatabaseClient(env.DB);

  const chunks = await fetchAllReplayChunks(database, sessionId);

  if (chunks.length === 0) {
    return { success: false, screenshots: [], error: 'No replay data found' };
  }

  const allEvents = await reassembleReplayEvents(env.R2_BUCKET, chunks);

  const keyMoments = detectKeyMoments(allEvents);

  let targetMoments: KeyMoment[];
  if (requestedTimestamps && requestedTimestamps.length > 0) {
    const firstTimestamp =
      allEvents.length > 0 ? (allEvents[0].timestamp ?? 0) : 0;
    targetMoments = requestedTimestamps.map(ts => ({
      timestamp: ts,
      offsetMs: ts - firstTimestamp,
      eventType: 'requested',
      description: `Requested timestamp ${ts}`,
    }));
  } else {
    targetMoments = keyMoments;
  }

  if (maxMoments && targetMoments.length > maxMoments) {
    targetMoments = targetMoments.slice(0, maxMoments);
  }

  const viewport = getSessionViewport(allEvents);
  const html = buildReplayHtml(allEvents, viewport);

  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
  });
  await page.setContent(html, { waitUntil: 'networkidle0' });

  await page.waitForFunction(
    'window.__rrwebPlayer !== undefined && window.__renderReady === true'
  );

  const r2PublicUrl = env.R2_PUBLIC_URL || '';
  const screenshots: ScreenshotResult[] = [];

  for (const moment of targetMoments) {
    try {
      await page.evaluate((offsetMs: number) => {
        const player = (window as any).__rrwebPlayer;
        if (player && player.goto) {
          player.goto(offsetMs, false);
        }
      }, moment.offsetMs);

      await page.evaluate(() => {
        return new Promise<void>(resolve => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              setTimeout(resolve, 100);
            });
          });
        });
      });

      const screenshotBuffer = await page.screenshot({ type: 'png' });

      const r2Key = `screenshots/${projectId}/${sessionId}/${moment.timestamp}.png`;
      await env.R2_BUCKET.put(r2Key, screenshotBuffer, {
        httpMetadata: { contentType: 'image/png' },
      });

      const screenshotId = generateId('rscr');
      await database
        .insert(replayScreenshots)
        .values({
          id: screenshotId,
          projectId,
          sessionId,
          r2Key,
          timestamp: moment.timestamp,
          eventType: moment.eventType,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
        })
        .run();

      screenshots.push({
        timestamp: moment.timestamp,
        offsetMs: moment.offsetMs,
        eventType: moment.eventType,
        description: moment.description,
        r2Key,
        url: r2PublicUrl ? `${r2PublicUrl}/${r2Key}` : r2Key,
        clickPosition: moment.clickData
          ? { x: moment.clickData.x, y: moment.clickData.y }
          : undefined,
      });
    } catch (screenshotError) {
      logger.error(
        { error: screenshotError, timestamp: moment.timestamp },
        'Failed to capture screenshot at timestamp'
      );
    }
  }

  await browser.close();

  logger.info(
    { screenshotCount: screenshots.length },
    'Replay render complete'
  );

  return { success: true, viewport, screenshots };
}

export async function handleReplayRender(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = replayRenderRequestSchema.parse(requestBody);

    logger.info(
      {
        projectId: validatedData.projectId,
        sessionId: validatedData.sessionId,
      },
      'Replay render request'
    );

    const database = createDatabaseClient(environment.DB);

    const project = await findProjectByApiKey(
      database,
      validatedData.projectId
    );

    if (!project) {
      return createErrorResponse('Invalid project ID', 401);
    }

    const session = await findSessionById(database, validatedData.sessionId);

    if (!session) {
      return createErrorResponse('Session not found', 404);
    }

    const result = await renderScreenshotsForSession(
      environment,
      project.id,
      validatedData.sessionId,
      validatedData.timestamps
    );

    if (!result.success) {
      return createErrorResponse(result.error || 'Render failed', 404);
    }

    return new Response(
      JSON.stringify({
        success: true,
        viewport: result.viewport,
        screenshots: result.screenshots,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error rendering replay');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

export async function handleGetReplayScreenshots(
  request: Request,
  environment: Env,
  sessionId: string
): Promise<Response> {
  try {
    const database = createDatabaseClient(environment.DB);

    const screenshotRows = await database
      .select()
      .from(replayScreenshots)
      .where(eq(replayScreenshots.sessionId, sessionId))
      .orderBy(asc(replayScreenshots.timestamp))
      .all();

    const r2PublicUrl = environment.R2_PUBLIC_URL || '';

    const screenshotsWithUrls = screenshotRows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.eventType,
      viewportWidth: row.viewportWidth,
      viewportHeight: row.viewportHeight,
      r2Key: row.r2Key,
      url: r2PublicUrl ? `${r2PublicUrl}/${row.r2Key}` : row.r2Key,
      createdAt: row.createdAt,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        sessionId,
        screenshots: screenshotsWithUrls,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error fetching replay screenshots');
    return createErrorResponse('Internal server error', 500);
  }
}
