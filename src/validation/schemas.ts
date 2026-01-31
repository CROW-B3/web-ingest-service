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

export type ScreenSize = z.infer<typeof screenSizeSchema>;
export type Event = z.infer<typeof eventSchema>;
export type TrackRequest = z.infer<typeof trackRequestSchema>;
export type BatchRequest = z.infer<typeof batchRequestSchema>;
