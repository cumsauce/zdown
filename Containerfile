# --- frontend stage ---
FROM docker.io/library/node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build   # tsc + vite build → ../public (vite outDir)

# --- build stage ---
FROM docker.io/crystallang/crystal:1.22-alpine AS build
WORKDIR /app

# Static linking needs the -dev packages (static archives).
RUN apk add --no-cache \
      build-base sqlite-dev pcre2-dev openssl-dev zlib-dev \
      libevent-dev gc-dev yaml-dev

# Install shards first for layer caching
COPY shard.yml shard.lock ./
RUN shards install

COPY src/ src/
RUN crystal build --release --static src/server.cr -o bin/md_editor

# --- runtime stage ---
FROM docker.io/alpine:3.20
RUN apk add --no-cache git libgcc
WORKDIR /app

COPY --from=build /app/bin/md_editor /app/md_editor
# Built SPA (vite outDir ../public → /app/public in the frontend stage).
# server.public_dir defaults to ./public relative to WORKDIR, so this
# resolves without extra config.
COPY --from=frontend /app/public /app/public

# Data dir for SQLite DB + bare git mirrors; mount a volume here.
RUN mkdir -p /data
VOLUME /data

# config.example.toml has every key; mount one at this path.
# data_dir should point at /data; listen on 0.0.0.0 inside the container.
ENV MD_EDITOR_CONFIG=/etc/md_editor/config.toml
EXPOSE 3000

ENTRYPOINT ["/app/md_editor"]
