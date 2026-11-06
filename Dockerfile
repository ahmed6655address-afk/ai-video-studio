# syntax=docker/dockerfile:1

# ---- build stage: compile the React SPA and native SQLite bindings ----
# Alpine base: Debian's glibc/acl/attr CVE entries have no distributor fix,
# so the image policy cannot be satisfied on a Debian base.
FROM node:22.23.4-alpine3.23 AS build
WORKDIR /app

# better-sqlite3 ships musl prebuilds; these tools are the source-build fallback.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY src ./src
COPY scripts ./scripts
COPY server ./server
RUN npm run build && npm prune --omit=dev

# ---- runtime stage ----
FROM node:22.23.4-alpine3.23 AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

WORKDIR /app

# Apply the distribution's fixed packages, then keep only the runtime lib the
# native SQLite binding needs.
RUN apk upgrade --no-cache \
    && apk add --no-cache libstdc++

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server

RUN mkdir -p /data && chown -R node:node /app /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
