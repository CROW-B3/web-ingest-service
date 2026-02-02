import { z } from 'zod';

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

export const trackRequestSchema = z.object({
  sessionId: z.string(),
  event: eventSchema,
});

const maximumEventsPerBatchRequest = 100;

export const batchRequestSchema = z.object({
  sessionId: z.string(),
  events: z.array(eventSchema).min(1).max(maximumEventsPerBatchRequest),
});

// Session start request schema
export const sessionStartRequestSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  user: z.object({
    id: z.string().optional(),
    anonymousId: z.string(),
  }),
  context: z.object({
    url: z.string().url(),
    referrer: z.string().optional(),
    userAgent: z.string(),
  }),
});

// Session end request schema
export const sessionEndRequestSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  duration: z.number(),
});

export type ScreenSize = z.infer<typeof screenSizeSchema>;
export type Event = z.infer<typeof eventSchema>;
export type TrackRequest = z.infer<typeof trackRequestSchema>;
export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;
export type SessionEndRequest = z.infer<typeof sessionEndRequestSchema>;
