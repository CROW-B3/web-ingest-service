import { logger } from './logger';

export async function notifyCoreInteractionService(
  env: Env,
  sessionId: string,
  organizationId?: string | null
): Promise<void> {
  const url = env.CORE_INTERACTION_SERVICE_URL;
  if (!url) {
    logger.warn(
      { sessionId },
      'CORE_INTERACTION_SERVICE_URL is not set — skipping core service notification'
    );
    return;
  }
  try {
    const response = await fetch(`${url}/internal/web-sessions/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        organizationId: organizationId ?? null,
      }),
    });
    if (!response.ok) {
      logger.warn(
        { sessionId, status: response.status },
        'Core interaction service notification failed'
      );
    } else {
      logger.info({ sessionId }, 'Core interaction service notified');
    }
  } catch (error) {
    logger.warn(
      { error, sessionId },
      'Failed to notify core interaction service'
    );
  }
}
