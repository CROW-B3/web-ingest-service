const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, X-Internal-Key, X-Service-API-Key',
  'Access-Control-Max-Age': '86400',
};

export function createCorsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function createJsonResponse(
  body: Record<string, unknown>,
  statusCode: number
): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export function createErrorResponse(
  errorMessage: string,
  statusCode: number
): Response {
  return createJsonResponse(
    { success: false, errors: [errorMessage] },
    statusCode
  );
}

export function createValidationErrorResponse(
  validationErrors: unknown
): Response {
  return createJsonResponse(
    { success: false, errors: [validationErrors] },
    400
  );
}

export function createSuccessResponse(
  payload: Record<string, unknown>
): Response {
  return createJsonResponse({ success: true, ...payload }, 200);
}

export function createPayloadTooLargeResponse(errors: string[]): Response {
  return createJsonResponse({ success: false, errors }, 413);
}
