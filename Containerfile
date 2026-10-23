# md_editor — single static binary + built SPA on Alpine, run as non-root.
#   podman build -t localhost/md_editor:latest .

# --- frontend stage ---
FROM docker.io/library/node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build   # tsc + vite build → /app/public

# --- build stage ---
FROM docker.io/crystallang/crystal:1.22-alpine AS build
WORKDIR /app
# Static linking needs the -dev packages (static archives).
RUN apk add --no-cache \
      build-base sqlite-dev sqlite-static pcre2-dev openssl-dev openssl-libs-static \
      zlib-dev zlib-static libevent-dev libevent-static gc-dev yaml-dev yaml-static
COPY shard.yml shard.lock ./
RUN shards install --production
COPY src/ src/
RUN crystal build --release --static --no-debug src/server.cr -o bin/md_editor

# --- runtime stage ---
FROM docker.io/library/alpine:3.20
RUN apk add --no-cache git ca-certificates tzdata \
 && addgroup -S -g 1000 md && adduser -S -D -H -u 1000 -G md -h /data md \
 && mkdir -p /data /etc/md_editor && chown md:md /data \
 # mirrors live on a volume that may be owned by another uid (rootless
 # podman, restored backups); git refuses to touch those without this.
 && git config --system safe.directory '*'

COPY --from=build /app/bin/md_editor /app/md_editor
COPY --from=frontend /app/public /app/public

ENV MD_EDITOR_CONFIG=/etc/md_editor/config.toml \
    HOME=/data
WORKDIR /app
USER md:md
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1

ENTRYPOINT ["/app/md_editor"]
