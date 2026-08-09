FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=3001 \
    PUBLIC_DIR=/app/public \
    TZ=America/Sao_Paulo

RUN apk add --no-cache dumb-init tzdata

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node backend/ ./
RUN mkdir -p /app/backend/data /app/public && chown -R node:node /app

COPY --chown=node:node index.html design-system.css /app/public/
COPY --chown=node:node js/ /app/public/js/

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
