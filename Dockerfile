# Runtime image: the API server plus the built web UI. Mock only: no LLM, no tenant, no network needed.
# Multi-stage: stage 1 builds web/dist, stage 2 ships the server plus that build only. Non-root, no volumes.
# Built and run by hand under OrbStack (steps ND2 and ND3); no automated test runs the container.
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
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:5350/api/health').then(r=>r.json()).then(j=>process.exit(j.state==='ready'?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
