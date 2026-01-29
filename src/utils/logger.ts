import pino from 'pino';

export const logger = pino({
  level: 'info',
  base: {
    service: 'web-ingest-worker',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
