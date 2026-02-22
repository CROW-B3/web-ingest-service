import puppeteer from '@cloudflare/puppeteer';
import { asc, eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import {
  events,
  processedSessions,
  replayChunks,
  sessions,
  sessionScreenshots,
} from '../db/schema';
import { generateReplayViewerHtml } from '../templates/replay-viewer';
import { logger } from '../utils/logger';

interface TimelineEntry {
  timestamp: number;
  eventType: string;
  url: string;
  description: string;
  replayTimestampOffset: number | null;
}

const SCREENSHOT_EVENT_TYPES = new Set([
  'click',
  'rage_click',
  'navigation',
  'pageview',
  'error',
  'api_error',
]);

function buildEventDescription(event: {
  type: string;
  url: string;
  data: unknown;
}): string {
  const data = event.data as Record<string, unknown> | null;
  switch (event.type) {
    case 'click':
      return data?.elementText
        ? `Clicked '${data.elementText}'`
        : `Clicked element on ${event.url}`;
    case 'rage_click':
      return data?.elementText
        ? `Rage clicked '${data.elementText}'`
        : `Rage clicked on ${event.url}`;
    case 'navigation':
      return `Navigated to ${data?.toUrl || event.url}`;
    case 'pageview':
      return `Viewed ${event.url}`;
    case 'error':
      return `Error: ${data?.message || 'Unknown error'}`;
    case 'api_error':
      return `API error: ${data?.endpoint || 'Unknown endpoint'}`;
    default:
      return `${event.type} on ${event.url}`;
  }
}

export async function processExpiredSession(
  sessionId: string,
  env: Env
): Promise<void> {
  const db = createDatabaseClient(env.DB);

  // Phase A — Data Assembly

  try {
    // Fetch session metadata
    const session = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Fetch all events ordered by timestamp
    const sessionEvents = await db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(asc(events.timestamp))
      .all();

    // Fetch replay chunk metadata ordered by chunk_index
    const chunks = await db
      .select()
      .from(replayChunks)
      .where(eq(replayChunks.sessionId, sessionId))
      .orderBy(asc(replayChunks.chunkIndex))
      .all();

    // Fetch replay chunk data from R2
    const allRrwebEvents: unknown[] = [];
    let totalReplaySizeBytes = 0;

    for (const chunk of chunks) {
      const r2Object = await env.R2_BUCKET.get(chunk.r2Key);
      if (r2Object) {
        const chunkData = await r2Object.json<unknown[]>();
        allRrwebEvents.push(...chunkData);
        totalReplaySizeBytes += chunk.sizeBytes;
      }
    }

    // Determine replay start timestamp for offset calculation
    const replayStartTimestamp =
      chunks.length > 0 ? chunks[0].startTimestamp : null;

    // Build timeline
    const pagesVisited = new Set<string>();
    const eventTypeCounts: Record<string, number> = {};

    const timeline: TimelineEntry[] = sessionEvents.map(event => {
      pagesVisited.add(event.url);
      eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;

      return {
        timestamp: event.timestamp,
        eventType: event.type,
        url: event.url,
        description: buildEventDescription(event),
        replayTimestampOffset: replayStartTimestamp
          ? event.timestamp - replayStartTimestamp
          : null,
      };
    });

    // Calculate duration
    const durationMs =
      sessionEvents.length > 1
        ? sessionEvents[sessionEvents.length - 1].timestamp -
          sessionEvents[0].timestamp
        : session.durationInMilliseconds || 0;

    // Mark session as ended
    await db
      .update(sessions)
      .set({
        endedAt: new Date(),
        durationInMilliseconds: durationMs,
      })
      .where(eq(sessions.id, sessionId))
      .run();

    // Store timeline JSON in R2
    const timelineR2Key = `processed/${sessionId}/timeline.json`;
    await env.R2_BUCKET.put(
      timelineR2Key,
      JSON.stringify({
        sessionId,
        timeline,
        metadata: { pagesVisited: [...pagesVisited], eventTypeCounts },
      })
    );

    // Phase B — Headless Re-rendering & Screenshots

    const keyMoments = timeline.filter(entry =>
      SCREENSHOT_EVENT_TYPES.has(entry.eventType)
    );

    let screenshotCount = 0;

    if (keyMoments.length > 0 && allRrwebEvents.length > 0) {
      const browser = await puppeteer.launch(env.BROWSER);

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });

        // Serve replay HTML directly via data URL to avoid needing an HTTP route
        const replayHtml = generateReplayViewerHtml(allRrwebEvents);
        await page.setContent(replayHtml, { waitUntil: 'networkidle0' });

        // Wait for replay player to be ready
        await page.waitForFunction('window.__replayReady === true', {
          timeout: 30_000,
        });

        for (const moment of keyMoments) {
          if (moment.replayTimestampOffset === null) continue;

          try {
            // Seek to the key moment
            await page.evaluate(
              `window.__seekTo(${moment.replayTimestampOffset})`
            );

            // Take screenshot
            const screenshotBuffer = await page.screenshot({
              type: 'png',
              fullPage: false,
            });

            const screenshotR2Key = `screenshots/${sessionId}/${moment.timestamp}_${moment.eventType}.png`;
            const screenshotData = screenshotBuffer as Uint8Array;

            await env.R2_BUCKET.put(screenshotR2Key, screenshotData);

            // Insert screenshot record
            await db
              .insert(sessionScreenshots)
              .values({
                id: generateId('ss'),
                sessionId,
                eventType: moment.eventType,
                eventDescription: moment.description,
                timestamp: moment.timestamp,
                r2Key: screenshotR2Key,
                sizeBytes: screenshotData.byteLength,
              })
              .run();

            screenshotCount++;
          } catch (screenshotError) {
            logger.warn(
              { sessionId, moment, error: screenshotError },
              'Failed to capture screenshot for moment'
            );
          }
        }
      } finally {
        await browser.close();
      }
    }

    // Phase C — Finalize
    await db
      .insert(processedSessions)
      .values({
        id: generateId('ps'),
        sessionId,
        totalEvents: sessionEvents.length,
        totalReplayChunks: chunks.length,
        totalReplaySizeBytes,
        durationMs,
        pagesVisited: [...pagesVisited],
        eventTypeCounts,
        timelineR2Key,
        screenshotCount,
        processedAt: new Date(),
      })
      .run();

    logger.info(
      {
        sessionId,
        totalEvents: sessionEvents.length,
        totalReplayChunks: chunks.length,
        screenshotCount,
      },
      'Session processing completed'
    );
  } catch (error) {
    logger.error({ sessionId, error }, 'Session processing failed');
    throw error;
  }
}
