import { eq, asc } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import {
  events,
  projects,
  replayScreenshots,
  sessions,
  sessionMetrics,
} from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';

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

function describeEvent(event: any): string {
  const data = event.data;

  switch (event.type) {
    case 'pageview':
      return `Viewed page: "${data?.pageTitle || 'Unknown'}" at ${event.url}`;

    case 'click': {
      const target = data?.descriptor || data?.elementPath || 'unknown element';
      const heading = data?.nearestHeading
        ? ` (in section: "${data.nearestHeading}")`
        : '';
      const href = data?.href ? ` → navigates to ${data.href}` : '';
      return `Clicked ${target}${heading}${href}`;
    }

    case 'navigation':
      if (data?.initial) return `Landed on ${data.to}`;
      return `Navigated from ${data?.from || 'unknown'} to ${data?.to || 'unknown'}`;

    case 'scroll':
      return `Scrolled to ${data?.depth}% of page`;

    case 'rage_click':
      return `Rage-clicked ${data?.clickCount} times on ${data?.elementPath || 'element'} — user appears frustrated`;

    case 'error':
      return `Error occurred: ${data?.message || 'Unknown error'}`;

    case 'api_error':
      return `API request failed: ${data?.url || 'unknown endpoint'} (${data?.status || 'unknown status'})`;

    case 'form_focus':
      return `${data?.action === 'focus' ? 'Focused on' : 'Left'} form field: ${data?.name || data?.id || data?.tagName || 'unknown'}`;

    case 'hover':
      return `Hovered on ${data?.elementPath || 'element'} for ${data?.duration}ms`;

    case 'visibility':
      return data?.visible ? 'Returned to tab (tab became visible)' : 'Left tab (tab became hidden)';

    case 'engagement':
      if (data?.subtype === 'page_entry') return 'Entered page';
      if (data?.subtype === 'page_exit')
        return `Exited page (spent ${Math.round((data?.totalTimeOnPage || 0) / 1000)}s, scrolled to ${data?.maxScrollDepth || 0}%)`;
      if (data?.subtype === 'resize')
        return `Resized viewport to ${data?.viewport?.width}x${data?.viewport?.height}`;
      return `Engagement: ${data?.subtype || 'unknown'}`;

    case 'add_to_cart':
      return `Added to cart: ${data?.productName || data?.productId || 'product'}`;

    case 'variant_select':
      return `Selected variant: ${data?.variantName || data?.variantId || 'variant'}`;

    case 'image_zoom':
      return `Zoomed into product image`;

    case 'web_vital':
      return `Web Vital: ${data?.name || 'unknown'} = ${data?.value || 'unknown'}`;

    case 'performance':
      return `Performance metric: ${data?.name || data?.entryType || 'unknown'}`;

    case 'context_snapshot':
      return `Product context captured: ${data?.productId || 'unknown product'}`;

    default:
      return `${event.type} event`;
  }
}

async function findProjectByApiKey(database: any, apiKey: string) {
  return database
    .select()
    .from(projects)
    .where(eq(projects.apiKey, apiKey))
    .get();
}

export async function handleGetSessionTimeline(
  request: Request,
  environment: Env,
  sessionId: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId');

    if (!projectId) {
      return createErrorResponse('projectId query parameter is required', 400);
    }

    const database = createDatabaseClient(environment.DB);

    const project = await findProjectByApiKey(database, projectId);

    if (!project) {
      return createErrorResponse('Invalid project ID', 401);
    }

    // Fetch session info
    const session = await database
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    if (!session) {
      return createErrorResponse('Session not found', 404);
    }

    // Fetch all events for session, ordered by timestamp
    const sessionEvents = await database
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(asc(events.timestamp))
      .all();

    // Fetch screenshots if available
    const screenshotRows = await database
      .select()
      .from(replayScreenshots)
      .where(eq(replayScreenshots.sessionId, sessionId))
      .orderBy(asc(replayScreenshots.timestamp))
      .all();

    // Fetch session metrics if available
    const metrics = await database
      .select()
      .from(sessionMetrics)
      .where(eq(sessionMetrics.sessionId, sessionId))
      .get();

    const r2PublicUrl = environment.R2_PUBLIC_URL || '';

    // Build screenshot lookup by timestamp
    const screenshotsByTimestamp = new Map<
      number,
      { url: string; r2Key: string; eventType: string }
    >();
    for (const row of screenshotRows) {
      screenshotsByTimestamp.set(row.timestamp, {
        url: r2PublicUrl ? `${r2PublicUrl}/${row.r2Key}` : row.r2Key,
        r2Key: row.r2Key,
        eventType: row.eventType,
      });
    }

    // Build timeline entries with AI-friendly descriptions
    const timeline = sessionEvents.map((event: any) => {
      const eventData =
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      const eventWithData = { ...event, data: eventData };

      // Find closest screenshot (within 2 seconds)
      let closestScreenshot = null;
      const eventTs =
        event.timestamp instanceof Date
          ? event.timestamp.getTime()
          : event.timestamp;

      for (const [screenshotTs, screenshot] of screenshotsByTimestamp) {
        if (Math.abs(screenshotTs - eventTs) < 2000) {
          closestScreenshot = screenshot;
          break;
        }
      }

      return {
        id: event.id,
        type: event.type,
        timestamp: eventTs,
        url: event.url,
        description: describeEvent(eventWithData),
        data: eventData,
        screenshot: closestScreenshot,
      };
    });

    // Build session summary for AI
    const pageViews = sessionEvents.filter(
      (e: any) => e.type === 'pageview'
    );
    const clicks = sessionEvents.filter((e: any) => e.type === 'click');
    const navigations = sessionEvents.filter(
      (e: any) => e.type === 'navigation'
    );
    const errors = sessionEvents.filter((e: any) => e.type === 'error');
    const rageClicks = sessionEvents.filter(
      (e: any) => e.type === 'rage_click'
    );

    const pagesVisited = [
      ...new Set(pageViews.map((e: any) => e.url)),
    ];

    const summary = {
      sessionId: session.id,
      device: {
        type: session.deviceType,
        browser: session.browser,
        os: session.operatingSystem,
        userAgent: session.userAgent,
      },
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs: session.durationInMilliseconds,
      initialUrl: session.initialUrl,
      referrer: session.referrer,
      hasReplay: session.hasReplay,
      totalEvents: sessionEvents.length,
      totalPageViews: pageViews.length,
      totalClicks: clicks.length,
      totalNavigations: navigations.length,
      totalErrors: errors.length,
      totalRageClicks: rageClicks.length,
      pagesVisited,
      totalScreenshots: screenshotRows.length,
      metrics: metrics
        ? {
            totalTimeOnSite: metrics.totalTimeOnSite,
            pageViewCount: metrics.pageViewCount,
            maxScrollDepth: metrics.maxScrollDepth,
            rageClickCount: metrics.rageClickCount,
            interactionCount: metrics.interactionCount,
            errorCount: metrics.errorCount,
            webVitals: {
              lcp: metrics.lcpMs,
              fid: metrics.fidMs,
              cls: metrics.cls,
              fcp: metrics.fcpMs,
              ttfb: metrics.ttfbMs,
            },
          }
        : null,
    };

    return new Response(
      JSON.stringify({
        success: true,
        summary,
        timeline,
        screenshots: screenshotRows.map((row: any) => ({
          id: row.id,
          timestamp: row.timestamp,
          eventType: row.eventType,
          viewportWidth: row.viewportWidth,
          viewportHeight: row.viewportHeight,
          url: r2PublicUrl ? `${r2PublicUrl}/${row.r2Key}` : row.r2Key,
        })),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logger.error({ error }, 'Error fetching session timeline');
    return createErrorResponse('Internal server error', 500);
  }
}
