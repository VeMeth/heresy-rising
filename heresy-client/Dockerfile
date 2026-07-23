FROM node:20-alpine AS build

WORKDIR /app

COPY heresy-client/package.json heresy-client/package-lock.json* ./
RUN npm install

COPY heresy-client .
COPY quotes.txt ../quotes.txt
RUN npm run build

FROM node:20-alpine AS docs

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY site ./site
RUN npx vitepress build site

# Combine SPA build + VitePress docs into a single nginx document root.
# The VitePress build is copied INTO dist/docs/ so nginx's SPA catch-all
# (location / → dist/) serves both the SPA index.html and the docs pages
# from one tree. This eliminates the separate /docs/ location entirely and
# the alias/root/try_files quirks that came with it.
FROM build AS combined
COPY --from=docs /app/site/_site ./dist/docs

FROM nginx:1.27-alpine

COPY heresy-client/nginx/default.conf /etc/nginx/conf.d/default.conf.template
COPY heresy-client/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=combined /app/dist /usr/share/nginx/html

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
