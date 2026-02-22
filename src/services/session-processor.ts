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
import { generateReplayShellHtml } from '../templates/replay-viewer';
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
    logger.info({ sessionId }, 'Phase A: Fetching session metadata');
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

    logger.info(
      { sessionId, eventCount: sessionEvents.length },
      'Fetched events'
    );

    // Fetch replay chunk metadata ordered by chunk_index
    const chunks = await db
      .select()
      .from(replayChunks)
      .where(eq(replayChunks.sessionId, sessionId))
      .orderBy(asc(replayChunks.chunkIndex))
      .all();

    logger.info(
      { sessionId, chunkCount: chunks.length },
      'Fetched replay chunks'
    );

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

    logger.info(
      {
        sessionId,
        rrwebEventCount: allRrwebEvents.length,
        totalReplaySizeBytes,
      },
      'Fetched replay data from R2'
    );

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
        replayTimestampOffset:
          replayStartTimestamp !== null
            ? Math.max(0, event.timestamp - replayStartTimestamp)
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

    // Phase B — Headless Re-rendering & Screenshots

    const MAX_SCREENSHOTS = 30;
    const keyMoments = timeline
      .filter(entry => SCREENSHOT_EVENT_TYPES.has(entry.eventType))
      .slice(0, MAX_SCREENSHOTS);

    let screenshotCount = 0;

    logger.info(
      { sessionId, keyMomentCount: keyMoments.length },
      'Phase B: Starting screenshot capture'
    );

    if (keyMoments.length > 0 && allRrwebEvents.length > 0) {
      if (!env.BROWSER) {
        logger.warn(
          { sessionId },
          'BROWSER binding not available — skipping screenshots (not supported in local dev)'
        );
      } else {
        try {
          logger.info({ sessionId }, 'Launching headless browser');
          const BROWSER_TIMEOUT_MS = 120_000;
          const browser = await puppeteer.launch(env.BROWSER);
          logger.info({ sessionId }, 'Browser launched successfully');

          let browserClosed = false;
          const closeBrowser = async () => {
            if (browserClosed) return;
            browserClosed = true;
            try {
              await browser.close();
            } catch {}
          };

          const browserTimeout = setTimeout(async () => {
            logger.warn(
              { sessionId },
              'Browser timeout reached — force closing'
            );
            await closeBrowser();
          }, BROWSER_TIMEOUT_MS);

          try {
            const page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 720 });
            logger.info({ sessionId }, 'Page created with viewport 1280x720');

            // Set lightweight HTML shell (rrweb bundle only, no events data)
            const shellHtml = generateReplayShellHtml();
            logger.info(
              { sessionId, shellHtmlLength: shellHtml.length },
              'Setting page content (shell only)'
            );
            await page.setContent(shellHtml, {
              waitUntil: 'domcontentloaded',
            });
            logger.info({ sessionId }, 'Shell loaded, injecting events data');

            // Inject rrweb events in chunks to avoid CDP message size limits
            const CHUNK_SIZE = 50;
            const totalChunks = Math.ceil(allRrwebEvents.length / CHUNK_SIZE);
            for (let i = 0; i < allRrwebEvents.length; i += CHUNK_SIZE) {
              const chunk = allRrwebEvents.slice(i, i + CHUNK_SIZE);
              await page.evaluate((eventsChunk: unknown[]) => {
                (globalThis as any).__rrwebEvents.push(...eventsChunk);
              }, chunk as any);
            }
            logger.info(
              {
                sessionId,
                totalChunks,
                rrwebEventCount: allRrwebEvents.length,
              },
              'Events injected, initializing replayer'
            );

            // Initialize the replayer now that all events are loaded
            await page.evaluate(() => {
              (globalThis as any).__initReplayer();
            });

            // Wait for replay player to be ready
            await page.waitForFunction('window.__replayReady === true', {
              timeout: 30_000,
            });
            logger.info({ sessionId }, 'Replay player is ready');

            // Check if the replayer encountered an initialization error
            const replayError = await page.evaluate('window.__replayError');
            if (replayError) {
              logger.error(
                { sessionId, replayError },
                'Replayer failed to initialize — skipping screenshots'
              );
            } else {
              logger.info(
                { sessionId, momentCount: keyMoments.length },
                'Starting screenshot loop'
              );
              for (const moment of keyMoments) {
                if (moment.replayTimestampOffset === null) {
                  logger.warn(
                    {
                      sessionId,
                      eventType: moment.eventType,
                      timestamp: moment.timestamp,
                    },
                    'Skipping moment with null replayTimestampOffset'
                  );
                  continue;
                }

                try {
                  logger.info(
                    {
                      sessionId,
                      eventType: moment.eventType,
                      offset: moment.replayTimestampOffset,
                    },
                    'Seeking to moment'
                  );
                  // Seek to the key moment and wait for render
                  await page.evaluate(async (offset: number) => {
                    await (globalThis as any).__seekTo(offset);
                  }, moment.replayTimestampOffset);
                  logger.info(
                    { sessionId, eventType: moment.eventType },
                    'Seek complete, taking screenshot'
                  );

                  // Take screenshot
                  const screenshotBuffer = await page.screenshot({
                    type: 'png',
                    fullPage: false,
                  });

                  const screenshotR2Key = `screenshots/${sessionId}/${moment.timestamp}_${moment.eventType}.png`;
                  const screenshotData = screenshotBuffer as Uint8Array;
                  logger.info(
                    {
                      sessionId,
                      r2Key: screenshotR2Key,
                      sizeBytes: screenshotData.byteLength,
                    },
                    'Saving screenshot to R2'
                  );

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
                  logger.info(
                    {
                      sessionId,
                      eventType: moment.eventType,
                      timestamp: moment.timestamp,
                      screenshotCount,
                    },
                    'Screenshot captured and saved'
                  );
                } catch (screenshotError) {
                  logger.warn(
                    {
                      sessionId,
                      eventType: moment.eventType,
                      timestamp: moment.timestamp,
                      error: String(screenshotError),
                    },
                    'Failed to capture screenshot for moment'
                  );
                }
              }
            }
          } finally {
            clearTimeout(browserTimeout);
            await closeBrowser();
            logger.info({ sessionId, screenshotCount }, 'Browser closed');
          }
        } catch (phaseBError) {
          logger.error(
            { sessionId, error: String(phaseBError) },
            'Phase B failed — continuing to finalize session'
          );
        }
      }
    }

    // Phase C — Finalize
    logger.info({ sessionId }, 'Phase C: Saving processed session record');
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
