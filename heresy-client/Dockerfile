FROM node:20-alpine AS build

WORKDIR /app

# Install SPA deps first.
COPY heresy-client/package.json heresy-client/package-lock.json* ./
RUN npm install

# Build the VitePress docs BEFORE copying the SPA source (which would
# overwrite /app/package.json). Use a separate install dir for vitepress
# so it doesn't pollute the SPA's node_modules.
COPY package.json package-lock.json* /docs-deps/
RUN cd /docs-deps && npm install
COPY site ./site
RUN cd /docs-deps && npx vitepress build /app/site
RUN rm -rf ./public/docs && cp -r ./site/_site ./public/docs

# Copy the SPA source and build. This overwrites /app/package.json with
# the SPA's package.json, but vitepress is already installed in /docs-deps
# and the docs are already copied into public/docs.
COPY heresy-client .
COPY quotes.txt ../quotes.txt
RUN npm run build

FROM nginx:1.27-alpine

COPY heresy-client/nginx/default.conf /etc/nginx/conf.d/default.conf.template
COPY heresy-client/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
