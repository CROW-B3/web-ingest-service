import type { PointerCoordinateBatch } from '../types/pointer';
import { drizzle } from 'drizzle-orm/d1';
import { pointerBatches } from '../db/schema';
import { logger } from '../utils/logger';

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

    logger.info(
      {
        sessionId: batch.sessionId,
        coordinateCount: batch.coordinates?.length || 0,
        batchStartTime: batch.batchStartTime,
        batchEndTime: batch.batchEndTime,
        duration: `${batch.batchEndTime - batch.batchStartTime}ms`,
        url: batch.url,
        site: batch.site,
        hostname: batch.hostname,
        environment: batch.environment,
      },
      'Received pointer data batch'
    );

    // Log first and last coordinates
    if (batch.coordinates && batch.coordinates.length > 0) {
      logger.debug(
        { firstCoordinate: batch.coordinates[0] },
        'First coordinate in batch'
      );
      logger.debug(
        {
          lastCoordinate: batch.coordinates[batch.coordinates.length - 1],
        },
        'Last coordinate in batch'
      );

      // Log some sample coordinates in the middle
      if (batch.coordinates.length > 10) {
        const middleIndex = Math.floor(batch.coordinates.length / 2);
        logger.debug(
          {
            middleCoordinates: batch.coordinates.slice(
              middleIndex - 2,
              middleIndex + 3
            ),
          },
          'Middle coordinates sample'
        );
      }
    }

    // Create date string (YYYY-MM-DD) for partitioning
    const now = Date.now();
    const dateObj = new Date(now);
    const date = dateObj.toISOString().split('T')[0];

    // Insert batch into D1 database using Drizzle
    const coordinatesJson = JSON.stringify(batch.coordinates);

    const db = drizzle(env.DB);
    await db.insert(pointerBatches).values({
      sessionId: batch.sessionId,
      url: batch.url,
      site: batch.site || null,
      hostname: batch.hostname || null,
      environment: batch.environment || 'production',
      batchStartTime: batch.batchStartTime,
      batchEndTime: batch.batchEndTime,
      coordinateCount: batch.coordinates?.length || 0,
      coordinates: coordinatesJson,
      createdAt: now,
      date,
    });

    logger.info(
      {
        sessionId: batch.sessionId,
        coordinateCount: batch.coordinates?.length || 0,
        date,
      },
      'Pointer data batch stored in D1 successfully'
    );

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
    logger.error(
      error instanceof Error ? error : new Error(String(error)),
      'Error processing pointer data'
    );
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
