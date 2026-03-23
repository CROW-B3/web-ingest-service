import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler modules to avoid importing Cloudflare-specific code
vi.mock('../handlers/track', () => ({
  handleTrack: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../handlers/batch', () => ({
  handleBatch: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../handlers/session', () => ({
  handleSessionStart: vi.fn(() =>
    new Response(JSON.stringify({ sessionId: 'sess-123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  handleSessionEnd: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../handlers/sessions', () => ({
  handleListSessionsForOrganization: vi.fn(() =>
    new Response(JSON.stringify({ sessions: [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  ),
  handleGetSessionEvents: vi.fn(() =>
    new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  ),
  handleGetSessionReplay: vi.fn(() =>
    new Response(JSON.stringify({ replay: [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  ),
}));

vi.mock('../handlers/replay', () => ({
  handleReplayBatch: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../handlers/ingest', () => ({
  handleIngestSessionStart: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  handleIngestSessionEvent: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
  handleIngestSessionEnd: vi.fn(() =>
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../handlers/internal-sessions', () => ({
  handleGetInternalSessionData: vi.fn(() =>
    new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  ),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {},
}));

const mockEnv = {
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(() => ({ results: [] })),
        first: vi.fn(() => null),
        run: vi.fn(() => ({ success: true })),
      })),
    })),
  },
  CROW_WEB_SESSION: {
    get: vi.fn(),
    idFromName: vi.fn(),
    newUniqueId: vi.fn(),
  },
  INTERACTION_QUEUE: { send: vi.fn() },
  SESSION_EXPIRY_QUEUE: { send: vi.fn() },
  WEB_SESSION_EXPORT: { send: vi.fn() },
  AI: { run: vi.fn() },
  INTERNAL_GATEWAY_KEY: 'test-key',
  GATEWAY_URL: 'http://localhost:8000',
  SERVICE_API_KEY: 'test-service-key',
  CORE_INTERACTION_SERVICE_URL: 'http://localhost:8008',
};

// Import the default handler (which is { fetch, queue })
import handler from '../index';

// Helper to make requests using the fetch handler
async function makeRequest(path: string, init?: RequestInit): Promise<Response> {
  const url = `http://localhost${path}`;
  const request = new Request(url, init);
  return handler.fetch(request, mockEnv as any);
}

describe('web-ingest-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET / (health check)', () => {
    it('should return 200 with status ok', async () => {
      const res = await makeRequest('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const res = await makeRequest('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('POST /track', () => {
    it('should forward to track handler', async () => {
      const res = await makeRequest('/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'pageview', url: 'https://example.com' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/track', () => {
    it('should forward to track handler', async () => {
      const res = await makeRequest('/api/v1/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'click' }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /batch', () => {
    it('should forward to batch handler', async () => {
      const res = await makeRequest('/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /session/start', () => {
    it('should forward to session start handler', async () => {
      const res = await makeRequest('/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /session/end', () => {
    it('should forward to session end handler', async () => {
      const res = await makeRequest('/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /sessions/organization/:orgId (authenticated)', () => {
    it('should return 401 without authentication', async () => {
      const res = await makeRequest('/sessions/organization/org-123', {
        method: 'GET',
      });
      expect(res.status).toBe(401);
    });

    it('should return sessions with internal key', async () => {
      const res = await makeRequest('/sessions/organization/org-123', {
        method: 'GET',
        headers: { 'X-Internal-Key': 'test-key' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /sessions/:id/events (authenticated)', () => {
    it('should return 401 without authentication', async () => {
      const res = await makeRequest('/sessions/sess-123/events');
      expect(res.status).toBe(401);
    });

    it('should return events with internal key', async () => {
      const res = await makeRequest('/sessions/sess-123/events', {
        headers: { 'X-Internal-Key': 'test-key' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/ingest/session/start', () => {
    it('should forward to ingest session start handler', async () => {
      const res = await makeRequest('/api/v1/ingest/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/ingest/session/event', () => {
    it('should forward to ingest session event handler', async () => {
      const res = await makeRequest('/api/v1/ingest/session/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/v1/ingest/session/end', () => {
    it('should forward to ingest session end handler', async () => {
      const res = await makeRequest('/api/v1/ingest/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('unknown routes', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await makeRequest('/unknown/path');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe('Not Found');
    });
  });

  describe('OPTIONS (CORS preflight)', () => {
    it('should return CORS preflight response', async () => {
      const res = await makeRequest('/track', { method: 'OPTIONS' });
      expect(res.status).toBe(204);
    });
  });

  describe('default export structure', () => {
    it('should export fetch and queue handlers', () => {
      expect(handler.fetch).toBeDefined();
      expect(typeof handler.fetch).toBe('function');
      expect(handler.queue).toBeDefined();
      expect(typeof handler.queue).toBe('function');
    });
  });
});
