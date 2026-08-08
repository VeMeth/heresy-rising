FROM node:20-alpine AS base

WORKDIR /usr/src/app

# Build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    nodejs \
    npm

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

COPY heresy-server/package.json heresy-server/package-lock.json* ./
RUN npm ci --omit=dev

COPY heresy-server/src ./src
COPY game_data ./config

# The engine mounts the mechanics playground at /api/playground, importing
# ../../playground/server/api.js — i.e. /usr/src/playground from WORKDIR
# /usr/src/app. Three things have to line up, because this image FLATTENS the
# repo (heresy-server/ becomes /usr/src/app) while the playground's imports
# assume the repo's sibling layout:
#   1. the playground source must be present at /usr/src/playground;
#   2. playground/server/* imports ../../heresy-server/src/* — which resolves
#      to /usr/src/heresy-server/src/*, so that name must point at /usr/src/app;
#   3. bare imports (express) resolve by walking UP from the importing file, and
#      nothing above /usr/src/playground has node_modules — only /usr/src/app does.
# Symlinks satisfy 2 and 3 without duplicating either the engine or its deps.
COPY playground/server /usr/src/playground/server
RUN ln -s /usr/src/app /usr/src/heresy-server && \
    ln -s /usr/src/app/node_modules /usr/src/node_modules

# COPY defaults to root:root ownership, but the container runs as nodejs
# (below). scenarios.js writes to /usr/src/playground/scenarios on demand
# (playground/server/scenarios.js's SCENARIOS_DIR, created lazily via
# mkdirSync on first save) — without this chown, nodejs has no write
# permission on the root-owned /usr/src/playground parent and every save
# fails with EACCES, exactly like `data/` would without the chown below.
RUN chown -R nodejs:nodejs /usr/src/playground

RUN mkdir -p data && chown -R nodejs:nodejs data

ENV NODE_ENV=production
ENV GAME_CONFIG_DIR=/usr/src/app/config
EXPOSE 4100

# Drop to non-root user
USER nodejs

CMD ["node", "src/index.js"]
