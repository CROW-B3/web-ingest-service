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

  return new Response(JSON.stringify({ success: true, session, events }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
