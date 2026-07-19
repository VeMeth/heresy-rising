FROM node:20-alpine AS base
WORKDIR /usr/src/app

# Ensure the data directory exists for session persistence (shared volume)
RUN mkdir -p /usr/src/app/data/bot-sessions

COPY bot-manager/package.json bot-manager/package-lock.json* ./
RUN npm install --omit=dev

COPY bot-manager/src ./src

ENV NODE_ENV=production
ENV HERESY_BOT_PORT=7878
EXPOSE 7878

CMD ["node", "src/index.js"]
