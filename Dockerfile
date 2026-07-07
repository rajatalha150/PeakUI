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

RUN apk add --no-cache bash curl git tar unzip wget python3 py3-pip poppler-utils tesseract-ocr tesseract-ocr-data-eng chromium chromium-chromedriver xvfb x11vnc imagemagick imagemagick-heic imagemagick-tiff imagemagick-webp libheif-tools

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/src/novnc.d.ts ./src/novnc.d.ts

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=::
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

CMD ["sh", "-c", "mkdir -p /mnt/openclaw/workspace /var/lib/peakui && if [ -z \"${JWT_SECRET:-}\" ] || [ ${#JWT_SECRET} -lt 32 ]; then if [ -f /var/lib/peakui/jwt-secret ]; then export JWT_SECRET=\"$(cat /var/lib/peakui/jwt-secret)\"; else export JWT_SECRET=\"$(head -c 48 /dev/urandom | base64 | tr -d '\\n' | cut -c1-64)\"; printf '%s' \"$JWT_SECRET\" >/var/lib/peakui/jwt-secret; chmod 600 /var/lib/peakui/jwt-secret; fi; fi && OPENCLAW_HOST_WORKSPACE_DIR=\"${OPENCLAW_HOST_WORKSPACE_DIR:-/home/raza/.peakui/workspace}\" && if [ \"$OPENCLAW_HOST_WORKSPACE_DIR\" != \"/mnt/openclaw/workspace\" ] && [ ! -e \"$OPENCLAW_HOST_WORKSPACE_DIR\" ] && ! printf '%s' \"$OPENCLAW_HOST_WORKSPACE_DIR\" | grep -qE '^[A-Za-z]:'; then mkdir -p \"$(dirname \"$OPENCLAW_HOST_WORKSPACE_DIR\")\" && ln -s /mnt/openclaw/workspace \"$OPENCLAW_HOST_WORKSPACE_DIR\"; fi && npx prisma db push && node server.js"]
