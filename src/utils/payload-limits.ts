/**
 * Payload Size Limits Utility
 * Enforces size limits on event payloads to prevent abuse and ensure performance
 */

export interface PayloadLimits {
  maxRequestSizeBytes: number; // Max total request size (default: 1MB)
  maxEventDataSizeBytes: number; // Max size of event.data JSON (default: 100KB)
  maxUrlLength: number; // Max URL length (default: 2048 chars)
  maxEventsPerBatch: number; // Max events in a batch (default: 100)
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Default payload limits
 */
export const DEFAULT_PAYLOAD_LIMITS: PayloadLimits = {
  maxRequestSizeBytes: 1024 * 1024, // 1MB
  maxEventDataSizeBytes: 100 * 1024, // 100KB
  maxUrlLength: 2048,
  maxEventsPerBatch: 100,
};

/**
 * Get size of an object in bytes (UTF-8 encoding)
 */
function getObjectSizeBytes(obj: any): number {
  const jsonStr = JSON.stringify(obj);
  // UTF-8 encoding: most chars are 1 byte, some are 2-4 bytes
  // Use TextEncoder for accurate byte count
  return new TextEncoder().encode(jsonStr).length;
}

/**
 * Truncate an object to fit within size limit
 */
function truncateObject(
  obj: any,
  maxSizeBytes: number
): { truncated: any; wasTruncated: boolean } {
  const currentSize = getObjectSizeBytes(obj);

  if (currentSize <= maxSizeBytes) {
    return { truncated: obj, wasTruncated: false };
  }

  // Simple truncation strategy: remove keys until size fits
  const truncated: any = { ...obj };
  const keys = Object.keys(truncated);

  // First, try truncating string values
  for (const key of keys) {
    if (typeof truncated[key] === 'string' && truncated[key].length > 1000) {
      truncated[key] = `${truncated[key].substring(0, 1000)}...[truncated]`;

      if (getObjectSizeBytes(truncated) <= maxSizeBytes) {
        return { truncated, wasTruncated: true };
      }
    }
  }

  // If still too large, start removing keys
  for (let i = keys.length - 1; i >= 0; i--) {
    delete truncated[keys[i]];

    if (getObjectSizeBytes(truncated) <= maxSizeBytes) {
      truncated._truncated = true;
      truncated._removedKeys = keys.slice(i);
      return { truncated, wasTruncated: true };
    }
  }

  // If still too large, return empty object with metadata
  return {
    truncated: {
      _truncated: true,
      _originalSize: currentSize,
      _error: 'Payload too large, data removed',
    },
    wasTruncated: true,
  };
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
  const warnings: string[] = [];

  const requestSize = getObjectSizeBytes(requestBody);

  if (requestSize > finalLimits.maxRequestSizeBytes) {
    errors.push(
      `Request size (${requestSize} bytes) exceeds maximum allowed (${finalLimits.maxRequestSizeBytes} bytes)`
    );
  }

  // Warn if request is over 50% of limit
  if (requestSize > finalLimits.maxRequestSizeBytes * 0.5) {
    warnings.push(
      `Request size (${requestSize} bytes) is large (>${finalLimits.maxRequestSizeBytes * 0.5} bytes)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate and truncate event data if needed
 */
export function validateEventData(
  eventData: any,
  limits: Partial<PayloadLimits> = {}
): {
  isValid: boolean;
  data: any;
  wasTruncated: boolean;
  errors: string[];
  warnings: string[];
} {
  const finalLimits: PayloadLimits = {
    ...DEFAULT_PAYLOAD_LIMITS,
    ...limits,
  };

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!eventData) {
    return {
      isValid: true,
      data: {},
      wasTruncated: false,
      errors: [],
      warnings: [],
    };
  }

  const dataSize = getObjectSizeBytes(eventData);

  // If within limits, return as-is
  if (dataSize <= finalLimits.maxEventDataSizeBytes) {
    return {
      isValid: true,
      data: eventData,
      wasTruncated: false,
      errors: [],
      warnings: [],
    };
  }

  // If over limit, try to truncate
  const { truncated, wasTruncated } = truncateObject(
    eventData,
    finalLimits.maxEventDataSizeBytes
  );

  if (wasTruncated) {
    warnings.push(
      `Event data (${dataSize} bytes) exceeded limit (${finalLimits.maxEventDataSizeBytes} bytes) and was truncated`
    );
  }

  return {
    isValid: true, // We truncate instead of rejecting
    data: truncated,
    wasTruncated,
    errors,
    warnings,
  };
}

/**
 * Validate URL length
 */
export function validateUrlLength(
  url: string,
  limits: Partial<PayloadLimits> = {}
): ValidationResult {
  const finalLimits: PayloadLimits = {
    ...DEFAULT_PAYLOAD_LIMITS,
    ...limits,
  };

  const errors: string[] = [];
  const warnings: string[] = [];

  if (url.length > finalLimits.maxUrlLength) {
    errors.push(
      `URL length (${url.length}) exceeds maximum allowed (${finalLimits.maxUrlLength})`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
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
  const warnings: string[] = [];

  if (eventCount > finalLimits.maxEventsPerBatch) {
    errors.push(
      `Batch size (${eventCount} events) exceeds maximum allowed (${finalLimits.maxEventsPerBatch} events)`
    );
  }

  // Warn if batch is over 80% of limit
  if (eventCount > finalLimits.maxEventsPerBatch * 0.8) {
    warnings.push(
      `Batch size (${eventCount} events) is large (>${finalLimits.maxEventsPerBatch * 0.8} events)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
