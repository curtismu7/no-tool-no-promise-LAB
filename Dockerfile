# Runtime image: the API server plus the built web UI. Mock only: no LLM, no tenant, no network needed.
# Not yet built or run (docker was not touched in step ND1).
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci -w web --ignore-scripts
COPY web web
RUN npm run build -w web

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NTNP_PORT=5350
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server --ignore-scripts && npm cache clean --force
COPY server/src server/src
COPY --from=web /app/web/dist web/dist
USER node
EXPOSE 5350
# Inside the container the server must listen on all interfaces, so NTNP_BIND is set here on purpose.
# The compose file publishes the port on 127.0.0.1 only; do not publish it more widely.
ENV NTNP_BIND=0.0.0.0
CMD ["node", "server/src/index.js"]
