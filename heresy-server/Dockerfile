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
RUN npm install --omit=dev

COPY heresy-server/src ./src
COPY data ./config

RUN mkdir -p data && chown -R nodejs:nodejs data

ENV NODE_ENV=production
ENV GAME_CONFIG_DIR=/usr/src/app/config
EXPOSE 4100

# Drop to non-root user
USER nodejs

CMD ["node", "src/index.js"]
