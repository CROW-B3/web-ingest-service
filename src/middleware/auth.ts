import { corsHeaders } from './cors';

const VALID_API_KEYS = [
  'crow_test_key_12345',
  'crow_dev_key_67890',
  'crow_local_key_abcdef',
];

export function extractApiKeyFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

export function isValidApiKey(apiKey: string | null): boolean {
  if (!apiKey) return false;
  return VALID_API_KEYS.includes(apiKey);
}

export function validateApiKey(request: Request): {
  valid: boolean;
  apiKey: string | null;
} {
  const apiKey = extractApiKeyFromRequest(request);
  return {
    valid: isValidApiKey(apiKey),
    apiKey,
  };
}

export function createUnauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      errors: ['Invalid or missing API key'],
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}
