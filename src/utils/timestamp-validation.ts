/**
 * Timestamp Validation Utility
 * Validates client-provided timestamps to detect clock skew and malformed data
 */

export interface TimestampValidationResult {
  isValid: boolean;
  reason?: string;
  adjustedTimestamp?: number;
}

export function validateTimestamp(
  timestamp: number,
  options: {
    maxFutureDrift?: number; // Max milliseconds in the future (default: 60s)
    maxPastAge?: number; // Max age in milliseconds (default: 24 hours)
    autoCorrect?: boolean; // Auto-correct to server time if invalid (default: false)
  } = {}
): TimestampValidationResult {
  const {
    maxFutureDrift = 60 * 1000, // 60 seconds
    maxPastAge = 24 * 60 * 60 * 1000, // 24 hours
    autoCorrect = false,
  } = options;

  const now = Date.now();
  const diff = timestamp - now;

  // Check for invalid timestamp format (not a valid number)
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return {
      isValid: false,
      reason: 'Invalid timestamp format',
      adjustedTimestamp: autoCorrect ? now : undefined,
    };
  }

  // Check for timestamps too far in the future (client clock ahead)
  if (diff > maxFutureDrift) {
    const futureSeconds = Math.floor(diff / 1000);
    return {
      isValid: false,
      reason: `Timestamp is ${futureSeconds}s in the future (client clock skew)`,
      adjustedTimestamp: autoCorrect ? now : undefined,
    };
  }

  // Check for timestamps too far in the past (very old events or client clock behind)
  if (diff < -maxPastAge) {
    const ageHours = Math.floor(Math.abs(diff) / (60 * 60 * 1000));
    return {
      isValid: false,
      reason: `Timestamp is ${ageHours}h old (event too old or client clock skew)`,
      adjustedTimestamp: autoCorrect ? now : undefined,
    };
  }

  // Timestamp is valid
  return {
    isValid: true,
  };
}

export function validateTimestampBatch(timestamps: number[]): {
  totalCount: number;
  validCount: number;
  invalidCount: number;
  avgClockSkew: number; // Average clock skew in milliseconds
  maxClockSkew: number; // Maximum clock skew detected
  reasons: Record<string, number>; // Grouped reasons for invalid timestamps
} {
  const now = Date.now();
  let validCount = 0;
  let invalidCount = 0;
  let totalSkew = 0;
  let maxClockSkew = 0;
  const reasons: Record<string, number> = {};

  for (const timestamp of timestamps) {
    const result = validateTimestamp(timestamp);

    if (result.isValid) {
      validCount++;
      const skew = Math.abs(timestamp - now);
      totalSkew += skew;
      maxClockSkew = Math.max(maxClockSkew, skew);
    } else {
      invalidCount++;
      if (result.reason) {
        reasons[result.reason] = (reasons[result.reason] || 0) + 1;
      }
    }
  }

  return {
    totalCount: timestamps.length,
    validCount,
    invalidCount,
    avgClockSkew: validCount > 0 ? totalSkew / validCount : 0,
    maxClockSkew,
    reasons,
  };
}
