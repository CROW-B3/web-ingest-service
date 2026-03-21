export function extractApiKeyFromRequest(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.substring(7);
}

export function createUnauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      errors: ['Invalid or missing API key'],
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
