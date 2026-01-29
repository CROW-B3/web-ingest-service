export interface PayloadLimits {
  maxRequestSizeBytes: number;
  maxEventsPerBatch: number;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

const oneMegabyteInBytes = 1024 * 1024;
const defaultMaxEventsPerBatch = 100;

export const DEFAULT_PAYLOAD_LIMITS: PayloadLimits = {
  maxRequestSizeBytes: oneMegabyteInBytes,
  maxEventsPerBatch: defaultMaxEventsPerBatch,
};

function calculateObjectSizeInBytes(object: any): number {
  const jsonString = JSON.stringify(object);
  return new TextEncoder().encode(jsonString).length;
}

function createValidationError(
  actualValue: number,
  maxValue: number,
  unit: string
): string {
  return `${unit} (${actualValue}) exceeds maximum allowed (${maxValue})`;
}

export function validateRequestSize(
  requestBody: any,
  limits: Partial<PayloadLimits> = {}
): ValidationResult {
  const finalLimits: PayloadLimits = {
    ...DEFAULT_PAYLOAD_LIMITS,
    ...limits,
  };

  const requestSizeInBytes = calculateObjectSizeInBytes(requestBody);
  const isRequestSizeValid =
    requestSizeInBytes <= finalLimits.maxRequestSizeBytes;

  if (isRequestSizeValid) {
    return { isValid: true, errors: [] };
  }

  const errorMessage = createValidationError(
    requestSizeInBytes,
    finalLimits.maxRequestSizeBytes,
    'Request size (bytes)'
  );

  return {
    isValid: false,
    errors: [errorMessage],
  };
}

export function validateBatchSize(
  eventCount: number,
  limits: Partial<PayloadLimits> = {}
): ValidationResult {
  const finalLimits: PayloadLimits = {
    ...DEFAULT_PAYLOAD_LIMITS,
    ...limits,
  };

  const isBatchSizeValid = eventCount <= finalLimits.maxEventsPerBatch;

  if (isBatchSizeValid) {
    return { isValid: true, errors: [] };
  }

  const errorMessage = createValidationError(
    eventCount,
    finalLimits.maxEventsPerBatch,
    'Batch size (events)'
  );

  return {
    isValid: false,
    errors: [errorMessage],
  };
}
