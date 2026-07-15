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

FROM nginx:1.27-alpine

COPY heresy-client/nginx/default.conf /etc/nginx/conf.d/default.conf.template
COPY heresy-client/nginx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=docs /app/_site /usr/share/nginx/html/docs

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
