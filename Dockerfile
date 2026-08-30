# syntax=docker/dockerfile:1
#
# One image, one process, one port. The hub serves both the WebSocket world and
# the built client, so there is no CORS surface, the socket shares the page's
# origin, and a reverse proxy has a single upstream to route.
#
# node:22-alpine is multi-arch; the deploy target is aarch64 (Raspberry Pi).
# Nothing here builds a native module, so no toolchain is needed at any stage.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# --- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/assets-pipeline/package.json packages/assets-pipeline/
COPY server/package.json server/
COPY client/package.json client/
COPY hooks/package.json hooks/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- build ------------------------------------------------------------------
FROM deps AS build
COPY . .
# The client bundle plus the committed GLBs; the server as a single bundled file.
RUN pnpm --filter client build && pnpm --filter server build

# --- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV OFFICE_STATIC_DIR=/app/public
ENV OFFICE_IDENTITY_PATH=/data/identities.json
WORKDIR /app

# The server bundle carries its own dependencies, so the runtime image needs no
# node_modules at all.
COPY --from=build /app/server/dist/server.cjs ./server.cjs
COPY --from=build /app/client/dist ./public

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.cjs"]
