FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY bin/download-validator.js ./bin/download-validator.js
RUN npm ci
COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# Alpine's nodejs package ships without npm/yarn, whose bundled dependencies we can't patch.
FROM alpine:3.24 AS production

RUN apk upgrade --no-cache && apk add --no-cache nodejs

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/dist ./dist

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001
USER nodejs

ENV PORT=8000
EXPOSE 8000

CMD ["node", "dist/sse.js"]
