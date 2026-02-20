import { corsHeaders } from '../middleware/cors';

function createJsonResponse(
  body: Record<string, unknown>,
  statusCode: number
): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
