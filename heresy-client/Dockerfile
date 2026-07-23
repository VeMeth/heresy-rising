FROM node:20-alpine AS build

WORKDIR /app

COPY heresy-client/package.json heresy-client/package-lock.json* ./
RUN npm install

COPY heresy-client .
COPY quotes.txt ../quotes.txt

# Build the VitePress docs and copy them into the SPA's public/ dir so
# Vite includes them in the SPA bundle as static assets. This means the
# final nginx image only needs the SPA dist — no separate docs stage,
# no combined stage, no try_files quirks, no Cloudflare routing splits.
COPY site ./site
RUN npx vitepress build site
RUN rm -rf ./public/docs && cp -r ./site/_site ./public/docs

RUN npm run build

FROM nginx:1.27-alpine

COPY heresy-client/nginx/default.conf /etc/nginx/conf.d/default.conf.template
COPY heresy-client/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
