/**
 * Payload Size Limits Utility
 * Enforces size limits on event payloads to prevent abuse and ensure performance
 */

export interface PayloadLimits {
  maxRequestSizeBytes: number; // Max total request size (default: 1MB)
  maxEventsPerBatch: number; // Max events in a batch (default: 100)
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Default payload limits
 */
export const DEFAULT_PAYLOAD_LIMITS: PayloadLimits = {
  maxRequestSizeBytes: 1024 * 1024, // 1MB
  maxEventsPerBatch: 100,
};

/**
 * Get size of an object in bytes (UTF-8 encoding)
 */
function getObjectSizeBytes(obj: any): number {
  const jsonStr = JSON.stringify(obj);
  return new TextEncoder().encode(jsonStr).length;
}

/**
 * Validate request payload size
 */
export function validateRequestSize(
  requestBody: any,
  limits: Partial<PayloadLimits> = {}
): ValidationResult {
  const finalLimits: PayloadLimits = {
    ...DEFAULT_PAYLOAD_LIMITS,
    ...limits,
  };

  const errors: string[] = [];

  const requestSize = getObjectSizeBytes(requestBody);

  if (requestSize > finalLimits.maxRequestSizeBytes) {
    errors.push(
      `Request size (${requestSize} bytes) exceeds maximum allowed (${finalLimits.maxRequestSizeBytes} bytes)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Validate batch size (number of events)
 */
export function validateBatchSize(
  eventCount: number,
  limits: Partial<PayloadLimits> = {}
): ValidationResult {
  const finalLimits: PayloadLimits = {
    ...DEFAULT_PAYLOAD_LIMITS,
    ...limits,
  };

  const errors: string[] = [];

  if (eventCount > finalLimits.maxEventsPerBatch) {
    errors.push(
      `Batch size (${eventCount} events) exceeds maximum allowed (${finalLimits.maxEventsPerBatch} events)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
