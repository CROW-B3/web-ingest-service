export interface AuthRequest extends Request {
  apiKey?: string;
}

export function extractApiKeyFromAuthHeader(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return null;

  // Extract bearer token from "Bearer <token>" format
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  return match[1];
}

export function validateApiKey(apiKey: string, allowedKeys: string[]): boolean {
  return allowedKeys.includes(apiKey);
}

export function parseAllowedApiKeys(apiKeysString: string): string[] {
  return apiKeysString
    .split(',')
    .map(key => key.trim())
    .filter(key => key.length > 0);
}

export function createUnauthorizedResponse(message: string = 'Unauthorized'): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}
