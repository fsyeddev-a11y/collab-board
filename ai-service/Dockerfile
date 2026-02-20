# ── Stage 1: Build ────────────────────────────────────────────────────────────
#
# Docker build context must be the MONOREPO ROOT so we can resolve the shared
# workspace package.  In Render, set the Dockerfile path to ai-service/Dockerfile
# and the build context to the repo root.
#
#   docker build -f ai-service/Dockerfile -t collabboard-ai .

FROM node:22-alpine AS builder

WORKDIR /app

# 1. Copy workspace root + package manifests (layer-cache friendly).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY ai-service/package.json ./ai-service/

# 2. Install all workspace deps.
RUN npm ci

# 3. Copy source and build shared first, then ai-service.
COPY shared/ ./shared/
RUN npm run build --workspace=@collabboard/shared

COPY ai-service/tsconfig.json ./ai-service/
COPY ai-service/src/ ./ai-service/src/
RUN npm run build --workspace=collabboard-ai-service

# ── Stage 2: Production runtime ───────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

# Copy compiled outputs and production node_modules.
COPY --from=builder /app/ai-service/dist ./ai-service/dist
COPY --from=builder /app/ai-service/package.json ./ai-service/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

USER app
EXPOSE 3001

WORKDIR /app/ai-service
CMD ["node", "--enable-source-maps", "dist/index.js"]
