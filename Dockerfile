FROM node:18-alpine

# tzdata lets the TZ env var actually shift cron's wall-clock schedule.
RUN apk add --no-cache tzdata

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY config ./config
COPY docker/crontab /etc/crontabs/root
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

CMD ["/usr/local/bin/entrypoint.sh"]
