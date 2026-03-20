import { z } from 'zod';

export const screenSizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export const eventSchema = z.object({
  type: z.enum([
    'pageview',
    'click',
    'form',
    'custom',
    'error',
    'navigation',
    'engagement',
    'scroll',
    'visibility',
    'rage_click',
    'hover',
    'form_focus',
    'add_to_cart',
    'variant_select',
    'image_zoom',
    'performance',
    'web_vital',
    'api_error',
  ]),
  timestamp: z.number(),
  url: z.string().url(),
  referrer: z.string().optional(),
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
  sessionId: z.string(),
  event: eventSchema,
});

const maximumEventsPerBatchRequest = 100;

export const batchRequestSchema = z.object({
  sessionId: z.string(),
  events: z.array(eventSchema).min(1).max(maximumEventsPerBatchRequest),
});

export const sessionStartRequestSchema = z.object({
  sessionId: z.string(),
  context: contextSchema,
  projectId: z.string().optional(),
});

const exitContextSchema = z
  .object({
    lastPageUrl: z.string().optional(),
    lastPageTitle: z.string().optional(),
    lastPageTimeSpentMs: z.number().optional(),
    exitTrigger: z
      .enum(['tab_close', 'navigation_away', 'idle_timeout'])
      .optional(),
    hadCartItems: z.boolean().optional(),
    lastInteractions: z
      .array(
        z.object({
          type: z.string(),
          timestamp: z.number(),
          description: z.string(),
        })
      )
      .max(20)
      .optional(),
    totalSessionDurationMs: z.number().optional(),
  })
  .optional();

export const sessionEndRequestSchema = z.object({
  sessionId: z.string(),
  duration: z.number(),
  pageViews: z.number(),
  interactions: z.number(),
  exitContext: exitContextSchema,
});

export const replayBatchRequestSchema = z.object({
  sessionId: z.string(),
  chunkIndex: z.number().int().min(0),
  events: z.array(z.any()).min(1),
  timestamp: z.number(),
});

export type ScreenSize = z.infer<typeof screenSizeSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Context = z.infer<typeof contextSchema>;
export type TrackRequest = z.infer<typeof trackRequestSchema>;
export type BatchRequest = z.infer<typeof batchRequestSchema>;
export type SessionStartRequest = z.infer<typeof sessionStartRequestSchema>;
export type SessionEndRequest = z.infer<typeof sessionEndRequestSchema>;
export type ReplayBatchRequest = z.infer<typeof replayBatchRequestSchema>;
