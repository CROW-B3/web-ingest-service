import { logger } from './logger';

/**
 * Lightweight trigger message sent to queue
 * The core-interaction-service will fetch the full event data from this service
 */
export interface SessionExportMessage {
  sessionId: string;
}

export interface QueueHandler {
  sendSessionToQueue: (message: SessionExportMessage) => Promise<void>;
}

export function createQueueHandler(
  queueBinding: Queue,
  env?: any
): QueueHandler {
  return {
    sendSessionToQueue: async (message: SessionExportMessage) => {
      try {
        // Send to queue for batch processing
        await queueBinding.send(message);
        logger.info(
          {
            sessionId: message.sessionId,
            eventCount: message.eventCount,
          },
          'Session sent to queue for processing'
        );

        // Also trigger processing via HTTP call to interaction service (optional, for faster processing)
        if (env?.INTERACTION_SERVICE_URL) {
          try {
            const interactionServiceUrl = env.INTERACTION_SERVICE_URL;
            const triggerUrl = `${interactionServiceUrl}/sessions/${message.sessionId}/process`;

            logger.debug(
              {
                sessionId: message.sessionId,
                url: triggerUrl,
              },
              'Sending session processing trigger via HTTP'
            );

            const response = await fetch(triggerUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: 10000, // 10 second timeout
            });

            if (!response.ok) {
              logger.warn(
                {
                  sessionId: message.sessionId,
                  status: response.status,
                  statusText: response.statusText,
                },
                'HTTP trigger to interaction service returned non-OK status'
              );
            } else {
              const result = await response.json<any>();
              logger.info(
                {
                  sessionId: message.sessionId,
                  result,
                },
                'Successfully sent processing trigger via HTTP'
              );
            }
          } catch (httpError) {
            logger.warn(
              {
                sessionId: message.sessionId,
                httpError,
              },
              'Failed to send HTTP trigger, but queue message was sent (will be processed by queue consumer)'
            );
            // Don't throw - the queue message was sent successfully
          }
        }
      } catch (error) {
        logger.error(
          {
            sessionId: message.sessionId,
            error,
          },
          'Failed to send session to queue'
        );
        throw error;
      }
    },
  };
}
