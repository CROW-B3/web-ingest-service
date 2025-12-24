import type { PointerCoordinateBatch } from '../types/pointer';
import { drizzle } from 'drizzle-orm/d1';
import { interactionBatches, pointerBatches } from '../db/schema';

/**
 * Handle pointer coordinate batch upload
 */
export async function handlePointerDataUpload(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    // Parse JSON body
    const batch = (await request.json()) as PointerCoordinateBatch;

    // Console.warn for testing
    console.warn('[PointerData] Received batch:', {
      sessionId: batch.sessionId,
      coordinateCount: batch.coordinates?.length || 0,
      batchStartTime: batch.batchStartTime,
      batchEndTime: batch.batchEndTime,
      duration: `${batch.batchEndTime - batch.batchStartTime}ms`,
      url: batch.url,
      site: batch.site,
      hostname: batch.hostname,
      environment: batch.environment,
    });

    // Log first and last coordinates
    if (batch.coordinates && batch.coordinates.length > 0) {
      console.warn('[PointerData] First coordinate:', batch.coordinates[0]);
      console.warn(
        '[PointerData] Last coordinate:',
        batch.coordinates[batch.coordinates.length - 1]
      );

      // Log some sample coordinates in the middle
      if (batch.coordinates.length > 10) {
        const middleIndex = Math.floor(batch.coordinates.length / 2);
        console.warn(
          '[PointerData] Middle coordinates (sample):',
          batch.coordinates.slice(middleIndex - 2, middleIndex + 3)
        );
      }
    }

    // Create date string (YYYY-MM-DD) for partitioning
    const now = Date.now();
    const dateObj = new Date(now);
    const date = dateObj.toISOString().split('T')[0];

    const db = drizzle(env.DB);

    // Create interaction batch first (new normalized schema)
    const interactionBatchResult = await db
      .insert(interactionBatches)
      .values({
        sessionId: batch.sessionId,
        url: batch.url,
        site: batch.site || 'unknown',
        hostname: batch.hostname || 'unknown',
        environment: batch.environment || 'production',
        userAgent: null,
        batchStartTime: batch.batchStartTime,
        batchEndTime: batch.batchEndTime,
        hasScreenshot: false,
        hasPointerData: true,
        createdAt: now,
        date,
      })
      .returning();

    const batchId = interactionBatchResult[0].id;

    // Insert pointer-specific data
    const coordinatesJson = JSON.stringify(batch.coordinates);
    await db.insert(pointerBatches).values({
      batchId,
      coordinateCount: batch.coordinates?.length || 0,
      coordinates: coordinatesJson,
    });

    console.warn('[PointerData] Batch stored in D1 successfully:', {
      sessionId: batch.sessionId,
      coordinateCount: batch.coordinates?.length || 0,
      date,
    });

    return new Response(
      JSON.stringify({
        success: true,
        sessionId: batch.sessionId,
        coordinatesReceived: batch.coordinates?.length || 0,
        batchDuration: batch.batchEndTime - batch.batchStartTime,
        stored: true,
        date,
        message: 'Pointer data received and stored in D1 successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[PointerData] Error processing pointer data:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
