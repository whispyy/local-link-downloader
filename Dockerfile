# ─── Stage 1: Build the React frontend ───────────────────────────────────────
FROM node:20-alpine AS frontend-builder

# Accept the git commit SHA from the CI build pipeline (e.g. GitHub Actions).
# Falls back to "unknown" when building locally without passing the arg.
# Not promoted to ENV — only needed during the frontend build step.
ARG COMMIT_HASH=unknown

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY index.html vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY postcss.config.js tailwind.config.js eslint.config.js ./
COPY src/ ./src/
RUN COMMIT_HASH=$COMMIT_HASH npm run build

# ─── Stage 2: Build the Express server ───────────────────────────────────────
FROM node:20-alpine AS server-builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.server.json tsconfig.server.build.json ./
RUN npm ci

COPY server/ ./server/

# Compile TypeScript server to JavaScript
RUN npx tsc --project tsconfig.server.build.json

# Copy server/package.json into dist/server/ so Node.js treats the
# compiled output as CommonJS (overrides the root "type": "module")
RUN cp server/package.json dist/server/package.json

# ─── Stage 3: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy compiled server (includes server/package.json with "type": "commonjs")
COPY --from=server-builder /app/dist/server ./dist/server

# Copy built frontend
COPY --from=frontend-builder /app/dist ./public

# Default environment
ENV NODE_ENV=production \
    API_PORT=3000 \
    STATIC_DIR=/app/public \
    LOG_DIR=/app/logs

# Create default log directory
RUN mkdir -p /app/logs

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
