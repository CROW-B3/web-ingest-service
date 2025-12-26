import process from 'node:process';

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  out: './migrations',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId:
      process.env.CLOUDFLARE_ACCOUNT_ID || '8f0203259905d8923687286c84921e6c',
    databaseId:
      process.env.D1_DATABASE_ID || 'e73411e4-8c1b-48a6-ad20-2bd74249d29a',
    token: process.env.CLOUDFLARE_API_TOKEN || '',
  },
});
