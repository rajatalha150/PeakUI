FROM node:22-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

RUN apk add --no-cache bash curl git tar unzip wget python3 py3-pip poppler-utils tesseract-ocr tesseract-ocr-data-eng chromium chromium-chromedriver

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

CMD ["sh", "-c", "mkdir -p /mnt/openclaw/workspace && if [ \"${OPENCLAW_HOST_WORKSPACE_DIR:-/tmp/viewllama-openclaw-workspace}\" != \"/mnt/openclaw/workspace\" ] && [ ! -e \"${OPENCLAW_HOST_WORKSPACE_DIR:-/tmp/viewllama-openclaw-workspace}\" ]; then mkdir -p \"$(dirname \"${OPENCLAW_HOST_WORKSPACE_DIR:-/tmp/viewllama-openclaw-workspace}\")\" && ln -s /mnt/openclaw/workspace \"${OPENCLAW_HOST_WORKSPACE_DIR:-/tmp/viewllama-openclaw-workspace}\"; fi && npx prisma db push && node server.js"]
