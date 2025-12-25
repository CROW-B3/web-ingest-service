import process from 'node:process';
import pino from 'pino';

const isDevelopment =
  typeof globalThis !== 'undefined' &&
  (process.env?.NODE_ENV === 'development' ||
    process.env?.ENVIRONMENT === 'development');

export const logger = pino({
  level: isDevelopment ? 'debug' : 'info',
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: {
    service: 'web-ingest-worker',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
