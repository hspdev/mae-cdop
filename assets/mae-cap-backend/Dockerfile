FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files first for layer caching
COPY package*.json ./
COPY patches/ ./patches/

# Install all deps (postinstall applies the better-sqlite3 → sql.js shim)
RUN npm ci --legacy-peer-deps --ignore-scripts && \
    node scripts/apply-shim.js 2>/dev/null || true && \
    node -e "require('better-sqlite3')(':memory:').close(); console.log('shim ok')" 2>/dev/null || \
    node patches/apply-shim-ci.js

# ── Runtime image ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

# Build CDS model for production
RUN node node_modules/@sap/cds-dk/bin/cds.js build --production || true

RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD wget -qO- http://localhost:8080/health || exit 1

# Deploy schema + start server
CMD ["node", "-e", "\
  const {execSync}=require('child_process'); \
  const fs=require('fs'); \
  if(!fs.existsSync('mae-cdop.db')){ \
    execSync('node node_modules/@sap/cds-dk/bin/cds.js deploy --to sqlite:mae-cdop.db',{stdio:\\'inherit\\'}); \
  } \
  require('./server'); \
"]
