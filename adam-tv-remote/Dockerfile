# Built on the Umbrel from ${APP_DATA_DIR} (pull_policy: build). Zero npm deps —
# just the single server.js, so the build is a plain base image + one file copy.
FROM node:22-alpine
WORKDIR /app
COPY server.js ./server.js
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
