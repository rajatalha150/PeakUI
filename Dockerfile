# This Dockerfile builds a Linux container. It is the only supported image target.
# On Windows use Docker Desktop with the WSL2 backend and Linux containers enabled.
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
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache bash curl git tar unzip wget python3 py3-pip poppler-utils tesseract-ocr tesseract-ocr-data-eng chromium chromium-chromedriver xvfb x11vnc imagemagick imagemagick-heic imagemagick-tiff imagemagick-webp libheif-tools docker-cli docker-cli-compose

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/novnc.d.ts ./src/novnc.d.ts
COPY --from=builder /app/irs_forms ./irs_forms
COPY --from=builder /app/scripts/coder-preview-gateway.mjs ./scripts/coder-preview-gateway.mjs
COPY --from=builder /app/scripts/start-peakui.sh ./scripts/start-peakui.sh
RUN chmod 755 ./scripts/start-peakui.sh

EXPOSE 3000 4173
ENV PORT=3000
ENV HOSTNAME=::
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Production startup fails closed on migration errors. Legacy databases must
# be explicitly baselined after a schema comparison and a verified backup.
CMD ["./scripts/start-peakui.sh"]
