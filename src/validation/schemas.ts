import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().optional(),
  anonymousId: z.string(),
});

export const screenSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export const eventSchema = z.object({
  type: z.enum(['pageview', 'click', 'form', 'custom', 'error']),
  timestamp: z.number(),
  url: z.string().url(),
  data: z.record(z.string(), z.any()).optional(),
  userAgent: z.string().optional(),
  screenSize: screenSizeSchema.optional(),
});

export const contextSchema = z.object({
  url: z.string().url(),
  referrer: z.string().optional(),
  userAgent: z.string(),
  screenSize: screenSizeSchema,
  timezone: z.string(),
  locale: z.string(),
});

export const trackRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  event: eventSchema,
  user: userSchema.optional(),
});

const maximumEventsPerBatchRequest = 100;

export const batchRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  events: z.array(eventSchema).min(1).max(maximumEventsPerBatchRequest),
  user: userSchema.optional(),
});

export const sessionStartRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  user: userSchema,
  context: contextSchema,
});

export const sessionEndRequestSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  duration: z.number(),
  pageViews: z.number(),
  interactions: z.number(),
});

export type User = z.infer<typeof userSchema>;
export type ScreenSize = z.infer<typeof screenSizeSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Context = z.infer<typeof contextSchema>;
export type TrackRequest = z.infer<typeof trackRequestSchema>;
export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;
export type SessionEndRequest = z.infer<typeof sessionEndRequestSchema>;
