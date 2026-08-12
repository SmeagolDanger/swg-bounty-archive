FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
LABEL org.opencontainers.image.source="https://github.com/SmeagolDanger/swg-bounty-archive"
LABEL org.opencontainers.image.description="Outer Rim Ledger SWG Legends Bounty Hunter archive"
RUN apk add --no-cache postgresql-client bash curl
COPY --from=builder /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
