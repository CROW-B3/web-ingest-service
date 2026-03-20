import { createDatabaseClient } from '../db/client';
import { corsHeaders } from '../middleware/cors';
import { findEventsBySessionId } from '../repositories/event-repository';
import { findSessionById } from '../repositories/session-repository';

export async function handleGetInternalSessionData(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response> {
  const match = pathname.match(/^\/internal\/sessions\/([^/]+)\/data$/);
  if (!match) {
    return new Response(JSON.stringify({ error: 'Invalid path' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const sessionId = match[1];
  const database = createDatabaseClient(env.DB);

  const session = await findSessionById(database, sessionId);
  if (!session) {
    return new Response(
      JSON.stringify({ success: false, error: 'Session not found' }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  const events = await findEventsBySessionId(database, sessionId);

  // Query rrweb_snapshots from D1 for this session
  let rrwebSnapshots: {
    id: string;
    sessionId: string;
    timestamp: number;
    eventType: string;
    data: string;
    compressed: number;
  }[] = [];
  try {
    const snapshotResult = await env.DB.prepare(
      'SELECT id, session_id, timestamp, event_type, data, compressed FROM rrweb_snapshots WHERE session_id = ? ORDER BY timestamp ASC'
    )
      .bind(sessionId)
      .all();

    rrwebSnapshots = (snapshotResult.results ?? []).map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      data: row.data,
      compressed: row.compressed,
    }));
  } catch (err) {
    console.error('Failed to query rrweb_snapshots:', err);
  }

  return new Response(
    JSON.stringify({ success: true, session, events, rrwebSnapshots }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}
