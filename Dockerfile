# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Note: `prisma migrate deploy` intentionally does NOT run in this stage — there is
# no live DB during `docker build`. This stage is also reused at container-start time
# (via docker-compose's `migrate` service, targeting this stage) to run migrations
# against a real database before the `runner`-stage app container starts. Keeping
# the migration step here (builder) rather than in `runner` keeps the standalone
# runtime image minimal — it never needs the Prisma CLI, schema, or migrations dir.

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
