# Образ тревожной кнопки: только Node и уже собранные файлы, без npm install.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY public ./public
ENV PORT=3077 HOST=0.0.0.0 DATA_DIR=/data
VOLUME /data
EXPOSE 3077
CMD ["node", "server.mjs"]
