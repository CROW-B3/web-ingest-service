import { z } from 'zod';

/**
 * User schema for tracking user information
 */
export const userSchema = z.object({
  id: z.string().optional(),
  anonymousId: z.string(),
  traits: z.record(z.string(), z.any()).optional(),
});

/**
 * Screen size schema
 */
export const screenSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

/**
 * Event schema for individual events
 * Supports website-hook-sdk event types
 */
export const eventSchema = z.object({
  type: z.enum(['pageview', 'click', 'form', 'custom', 'error']),
  timestamp: z.number(),
  url: z.string().url(),
  referrer: z.string().optional(),
  data: z.record(z.string(), z.any()).optional(),
  userAgent: z.string().optional(),
  screenSize: screenSizeSchema.optional(),
});

/**
 * Context schema for session information
 */
export const contextSchema = z.object({
  url: z.string().url(),
  referrer: z.string().optional(),
  userAgent: z.string(),
  screenSize: screenSizeSchema,
  timezone: z.string(),
  locale: z.string(),
});

/**
 * POST /track request schema
 */
export const trackRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  event: eventSchema,
  user: userSchema.optional(),
});

/**
 * POST /batch request schema
 */
export const batchRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  events: z.array(eventSchema).min(1).max(100), // Limit batch size
  user: userSchema.optional(),
  idempotencyKey: z.string().optional(), // Optional idempotency key to prevent duplicate processing
});

/**
 * POST /session/start request schema
 */
export const sessionStartRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  user: userSchema,
  context: contextSchema,
});

/**
 * POST /session/end request schema
 */
export const sessionEndRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  duration: z.number(),
  pageViews: z.number(),
  interactions: z.number(),
});

// Type exports for TypeScript
export type User = z.infer<typeof userSchema>;
export type ScreenSize = z.infer<typeof screenSizeSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Context = z.infer<typeof contextSchema>;
export type TrackRequest = z.infer<typeof trackRequestSchema>;
export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;
export type SessionEndRequest = z.infer<typeof sessionEndRequestSchema>;
