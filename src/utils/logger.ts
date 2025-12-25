import pino from 'pino';

// Cloudflare Workers compatible logger configuration
export const logger = pino({
  level: 'info',
  base: {
    service: 'web-ingest-worker',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // No transport option - Workers don't support Node.js transports
});

export default logger;
