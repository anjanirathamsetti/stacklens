# syntax=docker/dockerfile:1.7
#
# StackLens server image (collector + UI).
#
#   docker build -f docker/Dockerfile -t stacklens .
#   docker run -p 4300:4300 -e DATABASE_URL=postgres://… stacklens        # external PostgreSQL (production)
#   docker run -p 4300:4300 -v stacklens-data:/data stacklens              # embedded PostgreSQL in /data
#
ARG NODE_VERSION=22.18.0

# ---- deps: install the workspace once, cached on the lockfile -------------------------------
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/types/package.json packages/types/
COPY packages/tracer/package.json packages/tracer/
COPY apps/server/package.json apps/server/
COPY examples/express-basic/package.json examples/express-basic/
COPY examples/nestjs-typeorm/package.json examples/nestjs-typeorm/
RUN npm ci --no-audit --no-fund

# ---- build: shared types, then the Next.js standalone server --------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/server apps/server
ENV NEXT_TELEMETRY_DISABLED=1 \
    STACKLENS_STANDALONE=1
RUN npm run build -w @stacklens/types && npm run build -w stacklens

# ---- runtime: only the standalone bundle ----------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=4300 \
    HOSTNAME=0.0.0.0 \
    STACKLENS_DATA_DIR=/data

RUN addgroup -S stacklens && adduser -S -G stacklens stacklens \
 && mkdir -p /data && chown stacklens:stacklens /data

COPY --from=build --chown=stacklens:stacklens /repo/apps/server/.next/standalone ./
COPY --from=build --chown=stacklens:stacklens /repo/apps/server/.next/static ./apps/server/.next/static

USER stacklens
VOLUME ["/data"]
EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/server.js"]
