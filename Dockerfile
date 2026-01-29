FROM oven/bun:1.3.3-alpine AS deps

WORKDIR /app

COPY package.json bun.lock ./

RUN bun install --frozen-lockfile

FROM oven/bun:1.3.3-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules

COPY . .

FROM oven/bun:1.3.3-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 workergroup && \
    adduser --system --uid 1001 workeruser

COPY --from=builder --chown=workeruser:workergroup /app/src ./src
COPY --from=builder --chown=workeruser:workergroup /app/wrangler.jsonc ./
COPY --from=builder --chown=workeruser:workergroup /app/package.json ./
COPY --from=builder --chown=workeruser:workergroup /app/node_modules ./node_modules
COPY --from=builder --chown=workeruser:workergroup /app/tsconfig.json ./

USER workeruser

EXPOSE 8787

ENV HOSTNAME=0.0.0.0

CMD ["bun", "run", "dev"]
