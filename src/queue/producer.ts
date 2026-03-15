export interface SessionExportMessage {
  sessionId: string;
  projectId: string;
  userId: string | null;
  anonymousId: string;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  metadata: {
    userAgent: string;
    browser: string;
    deviceType: string;
    operatingSystem: string;
    initialUrl: string;
    referrer: string | null;
    ipAddress: string;
    country: string | null;
  };
}

export async function sendSessionToQueue(
  queue: Queue<SessionExportMessage>,
  message: SessionExportMessage
): Promise<void> {
  await queue.send(message);
}

export async function sendSessionBatchToQueue(
  queue: Queue<SessionExportMessage>,
  messages: SessionExportMessage[]
): Promise<void> {
  const batch = messages.map(msg => ({ body: msg }));
  await queue.sendBatch(batch);
}
