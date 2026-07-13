#!/bin/sh

# Replace PORT_PLACEHOLDER in nginx config with SERVER_PORT
SERV_PORT=${SERVER_PORT:-4100}
echo "Replacing PORT_PLACEHOLDER with $SERV_PORT"
sed "s/PORT_PLACEHOLDER/$SERV_PORT/g" /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf
echo "Generated config:"
cat /etc/nginx/conf.d/default.conf | grep proxy_pass

# Start nginx
nginx -g "daemon off;"
