# Pantry Scoop: Node runs the TypeScript directly (type stripping), so there is no build step.
FROM node:22.23-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node
ENV DB_PATH=/app/data/pantry.db PORT=3210
EXPOSE 3210
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/auth/config').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
