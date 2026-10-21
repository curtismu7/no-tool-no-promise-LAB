# Runtime image for the API server (step ND0: no web UI yet). Mock only: no LLM, no tenant, no network needed.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NTNP_PORT=5350
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
USER node
EXPOSE 5350
# Inside the container the server must listen on all interfaces, so NTNP_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV NTNP_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
