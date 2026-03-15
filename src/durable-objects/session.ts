import { DurableObject } from 'cloudflare:workers';

const ALARM_DELAY_MS = 30 * 1000; // 30 seconds for testing (change to 60 * 60 * 1000 for production)

interface SessionMetadata {
  id: string;
  projectId: string;
  userId: string | null;
  anonymousId: string;
  startedAt: number;
  lastActivityAt: number;
  initialUrl: string;
  referrer: string | null;
  userAgent: string;
  ipAddress: string;
  country: string | null;
  deviceType: string;
  browser: string;
  operatingSystem: string;
}

interface StoredEvent {
  id: string;
  type: string;
  timestamp: number;
  url: string;
  dataJson: string;
  userAgent: string | null;
  screenSizeJson: string | null;
}

interface RRwebSnapshot {
  id: string;
  timestamp: number;
  snapshotJson: string;
  compressed: number;
}

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

function generateEventId(): string {
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 10)}`;
}

function generateSnapshotId(): string {
  return `snap_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 10)}`;
}

export class CrowWebSessionDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    ctx.blockConcurrencyWhile(async () => {
      await this.initializeSchema();
    });
  }

  private async initializeSchema(): Promise<void> {
    if (this.initialized) return;

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS session_metadata (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT,
        anonymous_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        initial_url TEXT,
        referrer TEXT,
        user_agent TEXT,
        ip_address TEXT,
        country TEXT,
        device_type TEXT,
        browser TEXT,
        operating_system TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        url TEXT NOT NULL,
        data_json TEXT,
        user_agent TEXT,
        screen_size_json TEXT
      );

      CREATE TABLE IF NOT EXISTS rrweb_snapshots (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        compressed INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_rrweb_timestamp ON rrweb_snapshots(timestamp);
    `);

    this.initialized = true;
  }

  async initializeSession(metadata: SessionMetadata): Promise<void> {
    const existingSession = this.sql
      .exec('SELECT id FROM session_metadata WHERE id = ?', metadata.id)
      .toArray();

    if (existingSession.length > 0) {
      this.sql.exec(
        'UPDATE session_metadata SET last_activity_at = ? WHERE id = ?',
        metadata.lastActivityAt,
        metadata.id
      );
    } else {
      this.sql.exec(
        `INSERT INTO session_metadata
         (id, project_id, user_id, anonymous_id, started_at, last_activity_at,
          initial_url, referrer, user_agent, ip_address, country,
          device_type, browser, operating_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        metadata.id,
        metadata.projectId,
        metadata.userId,
        metadata.anonymousId,
        metadata.startedAt,
        metadata.lastActivityAt,
        metadata.initialUrl,
        metadata.referrer,
        metadata.userAgent,
        metadata.ipAddress,
        metadata.country,
        metadata.deviceType,
        metadata.browser,
        metadata.operatingSystem
      );
    }

    await this.setAlarm();
  }

  async ingestEvents(events: any[]): Promise<number> {
    let insertedCount = 0;

    for (const event of events) {
      const eventId = generateEventId();
      const isRRwebEvent =
        event.type === 'rrweb_snapshot' || event.type === 'rrweb_incremental';

      if (isRRwebEvent && event.data?.rrwebEvent) {
        const snapshotId = generateSnapshotId();
        this.sql.exec(
          `INSERT INTO rrweb_snapshots (id, timestamp, snapshot_json, compressed)
           VALUES (?, ?, ?, ?)`,
          snapshotId,
          event.timestamp,
          JSON.stringify(event.data.rrwebEvent),
          event.data.compressed ? 1 : 0
        );
      } else {
        this.sql.exec(
          `INSERT INTO events (id, type, timestamp, url, data_json, user_agent, screen_size_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          eventId,
          event.type,
          event.timestamp,
          event.url,
          event.data ? JSON.stringify(event.data) : null,
          event.userAgent || null,
          event.screenSize ? JSON.stringify(event.screenSize) : null
        );
      }

      insertedCount++;
    }

    this.sql.exec(
      'UPDATE session_metadata SET last_activity_at = ?',
      Date.now()
    );

    await this.setAlarm();

    return insertedCount;
  }

  private async setAlarm(): Promise<void> {
    const alarmTime = Date.now() + ALARM_DELAY_MS;
    await this.ctx.storage.setAlarm(alarmTime);
  }

  async triggerExportNow(): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const metadata = this.getSessionMetadata();
    if (!metadata) return;

    const events = this.getAllEvents();
    const rrwebSnapshots = this.getAllRRwebSnapshots();

    await this.exportToD1(metadata, events, rrwebSnapshots);

    await this.sendToQueue(metadata, events.length + rrwebSnapshots.length);

    await this.triggerCoreInteractionAnalysis(metadata, events, rrwebSnapshots);
  }

  private async triggerCoreInteractionAnalysis(
    metadata: SessionMetadata,
    events: StoredEvent[],
    rrwebSnapshots: RRwebSnapshot[]
  ): Promise<void> {
    const serviceUrl = (this.env as any).CORE_INTERACTION_SERVICE_URL;
    if (!serviceUrl) {
      console.warn(
        '[DO] CORE_INTERACTION_SERVICE_URL not configured, skipping analysis'
      );
      return;
    }

    const formattedEvents = events.map(e => ({
      type: e.type,
      timestamp: e.timestamp,
      url: e.url,
      data: e.dataJson ? JSON.parse(e.dataJson) : null,
      userAgent: e.userAgent,
      screenSize: e.screenSizeJson ? JSON.parse(e.screenSizeJson) : null,
    }));

    const screenshotEvents = rrwebSnapshots
      .filter(s => {
        try {
          const parsed = JSON.parse(s.snapshotJson);
          return parsed.imageData;
        } catch {
          return false;
        }
      })
      .map(s => {
        const parsed = JSON.parse(s.snapshotJson);
        return {
          type: 'rrweb_snapshot',
          timestamp: s.timestamp,
          data: parsed,
        };
      });

    const payload = {
      sessionId: metadata.id,
      projectId: metadata.projectId,
      userId: metadata.userId,
      anonymousId: metadata.anonymousId,
      events: [...formattedEvents, ...screenshotEvents],
      metadata: {
        userAgent: metadata.userAgent,
        browser: metadata.browser,
        deviceType: metadata.deviceType,
        operatingSystem: metadata.operatingSystem,
        initialUrl: metadata.initialUrl,
        referrer: metadata.referrer,
        startedAt: metadata.startedAt,
        endedAt: metadata.lastActivityAt,
      },
    };

    try {
      // console.log(`[DO] Triggering core-interaction analysis for session ${metadata.id}`);
      const response = await fetch(`${serviceUrl}/analyze/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[DO] Core interaction service error: ${response.status} - ${errorText}`
        );
        return;
      }

      await response.json();
    } catch (error) {
      console.error(`[DO] Failed to trigger core interaction analysis:`, error);
    }
  }

  private getSessionMetadata(): SessionMetadata | null {
    const result = this.sql
      .exec('SELECT * FROM session_metadata LIMIT 1')
      .toArray();

    if (result.length === 0) return null;

    const row = result[0] as any;
    return {
      id: row.id,
      projectId: row.project_id,
      userId: row.user_id,
      anonymousId: row.anonymous_id,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      initialUrl: row.initial_url,
      referrer: row.referrer,
      userAgent: row.user_agent,
      ipAddress: row.ip_address,
      country: row.country,
      deviceType: row.device_type,
      browser: row.browser,
      operatingSystem: row.operating_system,
    };
  }

  private getAllEvents(): StoredEvent[] {
    const result = this.sql
      .exec('SELECT * FROM events ORDER BY timestamp ASC')
      .toArray();

    return result.map((row: any) => ({
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      url: row.url,
      dataJson: row.data_json,
      userAgent: row.user_agent,
      screenSizeJson: row.screen_size_json,
    }));
  }

  private getAllRRwebSnapshots(): RRwebSnapshot[] {
    const result = this.sql
      .exec('SELECT * FROM rrweb_snapshots ORDER BY timestamp ASC')
      .toArray();

    return result.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      snapshotJson: row.snapshot_json,
      compressed: row.compressed,
    }));
  }

  private async exportToD1(
    metadata: SessionMetadata,
    events: StoredEvent[],
    rrwebSnapshots: RRwebSnapshot[]
  ): Promise<void> {
    const db = this.env.DB;

    await db
      .prepare(
        `UPDATE sessions
         SET ended_at = ?, duration = ?, exported_to_interaction_service = 1, exported_at = ?
         WHERE id = ?`
      )
      .bind(
        Math.floor(metadata.lastActivityAt / 1000),
        metadata.lastActivityAt - metadata.startedAt,
        Math.floor(Date.now() / 1000),
        metadata.id
      )
      .run();

    for (const snapshot of rrwebSnapshots) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO rrweb_snapshots
           (id, session_id, timestamp, event_type, data, compressed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          snapshot.id,
          metadata.id,
          Math.floor(snapshot.timestamp / 1000),
          'snapshot',
          snapshot.snapshotJson,
          snapshot.compressed,
          Math.floor(Date.now() / 1000)
        )
        .run();
    }
  }

  private async sendToQueue(
    metadata: SessionMetadata,
    eventCount: number
  ): Promise<void> {
    const queue = this.env.WEB_SESSION_EXPORT;
    if (!queue) return;

    const message: SessionExportMessage = {
      sessionId: metadata.id,
      projectId: metadata.projectId,
      userId: metadata.userId,
      anonymousId: metadata.anonymousId,
      startedAt: metadata.startedAt,
      endedAt: metadata.lastActivityAt,
      eventCount,
      metadata: {
        userAgent: metadata.userAgent,
        browser: metadata.browser,
        deviceType: metadata.deviceType,
        operatingSystem: metadata.operatingSystem,
        initialUrl: metadata.initialUrl,
        referrer: metadata.referrer,
        ipAddress: metadata.ipAddress,
        country: metadata.country,
      },
    };

    await queue.send(message);
  }

  async getEventCount(): Promise<number> {
    const eventsResult = this.sql
      .exec('SELECT COUNT(*) as count FROM events')
      .toArray();
    const snapshotsResult = this.sql
      .exec('SELECT COUNT(*) as count FROM rrweb_snapshots')
      .toArray();

    const eventsCount = (eventsResult[0] as any)?.count || 0;
    const snapshotsCount = (snapshotsResult[0] as any)?.count || 0;

    return eventsCount + snapshotsCount;
  }

  async getSessionInfo(): Promise<{
    metadata: SessionMetadata | null;
    eventCount: number;
  }> {
    return {
      metadata: this.getSessionMetadata(),
      eventCount: await this.getEventCount(),
    };
  }
}
