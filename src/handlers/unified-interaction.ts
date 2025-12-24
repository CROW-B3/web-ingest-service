import type {
  NewInteractionBatch,
  NewPointerBatch,
  NewScreenshot,
} from '../db/schema';
import { drizzle } from 'drizzle-orm/d1';
import { interactionBatches, pointerBatches, screenshots } from '../db/schema';
import { createS3Client, uploadToR2 } from '../utils/s3';

/**
 * Handle unified interaction batch upload (screenshot + pointer data)
 * POST /interaction-batch
 */
export async function handleUnifiedInteractionUpload(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const formData = await request.formData();

    // Extract common batch metadata
    const sessionId = formData.get('sessionId') as string;
    const url = formData.get('url') as string;
    const site = formData.get('site') as string;
    const hostname = formData.get('hostname') as string;
    const environment = formData.get('environment') as string;
    const userAgent = formData.get('userAgent') as string;
    const batchStartTime = Number.parseInt(
      formData.get('batchStartTime') as string
    );
    const batchEndTime = Number.parseInt(
      formData.get('batchEndTime') as string
    );

    if (
      !sessionId ||
      !url ||
      !site ||
      !hostname ||
      !environment ||
      !batchStartTime ||
      !batchEndTime
    ) {
      return new Response(
        JSON.stringify({ error: 'Missing required batch metadata' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const db = drizzle(env.DB);
    const currentDate = new Date().toISOString().split('T')[0];
    const createdAt = Date.now();

    // Check if we have screenshot data
    const screenshotFile = formData.get('screenshot') as File | null;
    const hasScreenshot = !!screenshotFile;

    // Check if we have pointer data
    const pointerDataStr = formData.get('pointerData') as string | null;
    const hasPointerData = !!pointerDataStr;

    // Create interaction batch record with all common metadata
    const newBatch: NewInteractionBatch = {
      sessionId,
      url,
      site,
      hostname,
      environment,
      userAgent,
      batchStartTime,
      batchEndTime,
      hasScreenshot,
      hasPointerData,
      createdAt,
      date: currentDate,
    };

    const batchResult = await db
      .insert(interactionBatches)
      .values(newBatch)
      .returning();
    const batchId = batchResult[0].id;

    console.warn(
      `Created interaction batch ${batchId} for session ${sessionId}`
    );

    // Process screenshot if present
    let screenshotId: number | null = null;
    if (hasScreenshot && screenshotFile) {
      try {
        const screenshotFilename = formData.get('screenshotFilename') as string;
        const capturedAt = Number.parseInt(
          formData.get('screenshotTimestamp') as string
        );
        const viewportStr = formData.get('viewport') as string;

        const viewport = viewportStr ? JSON.parse(viewportStr) : null;

        // Upload to R2
        const s3Client = createS3Client(env);
        const r2Key = `${env.R2_UPLOAD_PREFIX}/${capturedAt}-${screenshotFilename}`;

        const r2Url = await uploadToR2(s3Client, env, {
          key: r2Key,
          file: screenshotFile,
          metadata: {
            site,
            hostname,
            environment,
            capturedAt: capturedAt.toString(),
          },
        });

        // Save screenshot-specific data to database (common data is in interaction_batches)
        const newScreenshot: NewScreenshot = {
          batchId,
          r2Url,
          filename: screenshotFilename,
          viewportWidth: viewport?.width || null,
          viewportHeight: viewport?.height || null,
          scrollX: viewport?.scrollX || null,
          scrollY: viewport?.scrollY || null,
          fileSize: screenshotFile.size,
          capturedAt,
        };

        const screenshotResult = await db
          .insert(screenshots)
          .values(newScreenshot)
          .returning();
        screenshotId = screenshotResult[0].id;

        console.warn(`Saved screenshot ${screenshotId} to R2: ${r2Url}`);
      } catch (error) {
        console.error('Failed to process screenshot:', error);
        // Continue processing even if screenshot fails
      }
    }

    // Process pointer data if present
    let pointerBatchId: number | null = null;
    if (hasPointerData && pointerDataStr) {
      try {
        const coordinatesData = JSON.parse(pointerDataStr);
        const coordinateCount =
          Number.parseInt(formData.get('coordinateCount') as string) ||
          coordinatesData.length;

        // Save pointer-specific data to database (common data is in interaction_batches)
        const newPointerBatch: NewPointerBatch = {
          batchId,
          coordinateCount,
          coordinates: JSON.stringify(coordinatesData),
        };

        const pointerResult = await db
          .insert(pointerBatches)
          .values(newPointerBatch)
          .returning();
        pointerBatchId = pointerResult[0].id;

        console.warn(
          `Saved pointer batch ${pointerBatchId} with ${coordinateCount} coordinates`
        );
      } catch (error) {
        console.error('Failed to process pointer data:', error);
        // Continue processing even if pointer data fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        batchId,
        screenshotId,
        pointerBatchId,
        hasScreenshot,
        hasPointerData,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing unified interaction batch:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process interaction batch',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
