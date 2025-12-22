import type { PointerCoordinateBatch } from '../types/pointer';

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

    // Insert batch into D1 database
    const coordinatesJson = JSON.stringify(batch.coordinates);

    await env.DB.prepare(
      `INSERT INTO pointer_batches (
        session_id,
        url,
        site,
        hostname,
        environment,
        batch_start_time,
        batch_end_time,
        coordinate_count,
        coordinates,
        created_at,
        date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        batch.sessionId,
        batch.url,
        batch.site || null,
        batch.hostname || null,
        batch.environment || 'production',
        batch.batchStartTime,
        batch.batchEndTime,
        batch.coordinates?.length || 0,
        coordinatesJson,
        now,
        date
      )
      .run();

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
