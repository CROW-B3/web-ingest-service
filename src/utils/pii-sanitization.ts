/**
 * PII Sanitization Utility
 * Detects and removes Personally Identifiable Information from event data
 */

/**
 * PII detection patterns
 */
const PII_PATTERNS = {
  // Email addresses
  email: /\b[\w.%+-]+@[A-Z0-9.-]+\.[A-Z|]{2,}\b/gi,

  // Phone numbers (various formats)
  phone: /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,

  // Credit card numbers (Visa, MC, Amex, Discover)
  creditCard: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

  // Social Security Numbers (US)
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,

  // IP addresses (IPv4)
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,

  // API keys and tokens (generic patterns)
  apiKey:
    /\b(?:api[_-]?key|api[_-]?token|access[_-]?token|secret[_-]?key|auth[_-]?token|bearer[_-]?token)[:=\s]+[\w-]{16,}\b/gi,

  // JWT tokens
  jwt: /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+\b/g,

  // Password in URL or query params
  passwordParam: /(?:password|passwd|pwd|pass)[:=][^&\s]+/gi,
};

/**
 * List of sensitive field names that should be redacted
 */
const SENSITIVE_FIELD_NAMES = [
  'password',
  'passwd',
  'pwd',
  'pass',
  'secret',
  'token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'credential',
  'cc',
  'creditcard',
  'credit_card',
  'cvv',
  'ssn',
  'social_security',
  'birth_date',
  'birthdate',
  'dob',
  'license',
  'passport',
];

/**
 * Redaction placeholder
 */
const REDACTED = '[REDACTED]';

/**
 * Check if a field name is sensitive
 */
function isSensitiveFieldName(fieldName: string): boolean {
  const lowerField = fieldName.toLowerCase();
  return SENSITIVE_FIELD_NAMES.some(sensitive =>
    lowerField.includes(sensitive)
  );
}

/**
 * Sanitize a string value to remove PII
 */
function sanitizeString(value: string): string {
  let sanitized = value;

  // Replace all PII patterns with redacted placeholder
  for (const [_type, pattern] of Object.entries(PII_PATTERNS)) {
    sanitized = sanitized.replace(pattern, REDACTED);
  }

  return sanitized;
}

/**
 * Recursively sanitize an object to remove PII
 */
function sanitizeObject(obj: any, depth = 0, maxDepth = 10): any {
  // Prevent infinite recursion
  if (depth > maxDepth) {
    return obj;
  }

  // Handle null or undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1, maxDepth));
  }

  // Handle strings
  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  // Handle non-object primitives
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle objects
  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    // Check if field name itself is sensitive
    if (isSensitiveFieldName(key)) {
      sanitized[key] = REDACTED;
      continue;
    }

    // Recursively sanitize the value
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, depth + 1, maxDepth);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Sanitize event data to remove PII
 * @param data - The event data object
 * @returns Sanitized data object with PII removed
 */
export function sanitizeEventData(
  data: Record<string, any> | undefined | null
): Record<string, any> {
  if (!data) {
    return {};
  }

  return sanitizeObject(data);
}

/**
 * Sanitize a URL to remove sensitive query parameters
 * @param url - The URL to sanitize
 * @returns Sanitized URL with sensitive params redacted
 */
export function sanitizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);

    // Check each query parameter
    for (const [key, value] of urlObj.searchParams.entries()) {
      if (isSensitiveFieldName(key)) {
        urlObj.searchParams.set(key, REDACTED);
      } else {
        // Sanitize the value for PII
        const sanitizedValue = sanitizeString(value);
        if (sanitizedValue !== value) {
          urlObj.searchParams.set(key, sanitizedValue);
        }
      }
    }

    return urlObj.toString();
  } catch {
    // If URL parsing fails, just sanitize as string
    return sanitizeString(url);
  }
}

/**
 * Check if data contains PII (for logging/monitoring)
 * @param data - The data to check
 * @returns true if PII was detected, false otherwise
 */
export function containsPII(data: any): boolean {
  if (!data) {
    return false;
  }

  const jsonStr = JSON.stringify(data);

  // Check against all PII patterns
  for (const pattern of Object.values(PII_PATTERNS)) {
    if (pattern.test(jsonStr)) {
      return true;
    }
  }

  // Check for sensitive field names
  if (typeof data === 'object' && !Array.isArray(data)) {
    for (const key of Object.keys(data)) {
      if (isSensitiveFieldName(key)) {
        return true;
      }
    }
  }

  return false;
}
