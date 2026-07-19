FROM node:20-alpine AS base
WORKDIR /usr/src/app

# Lightweight runtime — no native build needs (LangChain + Socket.IO are pure JS).
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs -h /usr/src/app

COPY bot-manager/package.json bot-manager/package-lock.json* ./
RUN npm install --omit=dev

COPY bot-manager/src ./src

ENV NODE_ENV=production
ENV HERESY_BOT_PORT=7878
EXPOSE 7878

USER nodejs
CMD ["node", "src/index.js"]