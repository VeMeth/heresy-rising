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

# heresy-sim is a *consumer* of the engine (heresy-server), not part of it —
# heresy-sim/src/runner.js imports HeresyGameManager directly via a relative
# path (`../../heresy-server/src/heresyGameManager.js`), assuming the two
# packages sit as siblings on disk (see heresy-sim/README.md, "Engine
# integration"). Build context must therefore be the repo root (same as
# heresy-server/Dockerfile), so both trees can be copied in preserving that
# same relative layout — the import path itself is never rewritten.
#
# Install heresy-sim's own deps (better-sqlite3, commander, express) at the
# WORKDIR root rather than under heresy-sim/. Node's module resolution for a
# bare specifier walks UP from the *importing file's own location* — so once
# heresy-server/src is copied in below, heresy-server/src/*.js's own
# `import 'better-sqlite3'` resolves via .../heresy-server/src -> .../heresy-server
# -> .../app (this node_modules), the same directory tree heresy-sim/src's own
# imports resolve through. This deliberately does NOT `npm install`
# heresy-server/package.json's full dependency set (express/socket.io/helmet/
# etc.) — the only bare-specifier import reachable from heresyGameManager.js's
# own import graph is better-sqlite3 (checked: utils.js, gameConfig.js,
# mechanics/*.js, validators/composition.js, gameLogs.js are all node
# built-ins otherwise), and heresy-sim/package.json already declares it.
COPY heresy-sim/package.json heresy-sim/package-lock.json* ./
RUN npm install --omit=dev

COPY heresy-sim/src ./heresy-sim/src
COPY heresy-server/src ./heresy-server/src
COPY game_data ./config

RUN mkdir -p /usr/src/app/heresy-sim/sim-results && chown -R nodejs:nodejs /usr/src/app

ENV NODE_ENV=production
ENV GAME_CONFIG_DIR=/usr/src/app/config

# heresy-server=4100, bot-manager=7878, heresy-sim (this service)=7879
EXPOSE 7879

# Drop to non-root user
USER nodejs

# server.js is the container entrypoint (HTTP mode). src/index.js (the CLI)
# still works unchanged for local/ad-hoc batch runs — `docker run --rm
# <image> node heresy-sim/src/index.js run --games 100 --players 8`.
CMD ["node", "heresy-sim/src/server.js"]
