# ── Build stage ──────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3, argon2)
RUN apk add --no-cache python3 make g++

# Copy workspace root and package manifests first (layer cache)
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

# Install all dependencies (server + client)
RUN npm ci

# Copy source files
COPY server/ server/
COPY client/ client/

# Build frontend with Vite
RUN npx --workspace=client vite build --outDir dist

# ── Production stage ─────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy workspace root and package manifests
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/

# Install production dependencies only (no build tools needed at runtime)
# Native modules need build tools to compile; install temporarily then remove.
# Note: tsx (devDependency) is needed at runtime for TypeScript execution.
RUN apk add --no-cache python3 make g++ \
    && npm ci \
    && apk del python3 make g++

# Copy server source from builder
COPY --from=builder /app/server/src server/src

# Copy built client dist from builder
COPY --from=builder /app/client/dist client/dist

# ── Volume for persistent data (auth DB) ────────────────
# The data/ directory stores auth.db (users + sessions).
# Mount a persistent volume here to survive container restarts.
VOLUME ["/app/data"]

EXPOSE 3001
ENV NODE_ENV=production
ENV PORT=3001

# ── Required environment variables ──────────────────────
# SESSION_SECRET            — Secret for signing session cookies (REQUIRED)
# INITIAL_ADMIN_USERNAME    — Username for the initial admin account (first start only)
# INITIAL_ADMIN_EMAIL       — Email for the initial admin account (first start only)
# INITIAL_ADMIN_PASSWORD    — Password for the initial admin account (first start only)

CMD ["npx", "tsx", "server/src/index.ts"]
