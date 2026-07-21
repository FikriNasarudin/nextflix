FROM node:20-alpine AS fe-builder

WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.22-alpine AS builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=fe-builder /src/web/dist ./web/dist
RUN CGO_ENABLED=1 go build -ldflags="-w -s" -o /nextflix .

FROM alpine:3.19

RUN apk add --no-cache ffmpeg ca-certificates tzdata

COPY --from=builder /nextflix /usr/local/bin/nextflix

EXPOSE 8080

VOLUME ["/data", "/media"]

# Data directory structure (mirrors Jellyfin):
#   /data/media.db              — SQLite database
#   /data/metadata/library/      — Per-item metadata + images (sharded by ID)
#   /data/images/tmdb/           — Shared TMDB image cache
#   /data/collections/           — Collection JSON files
#   /data/transcodes/            — HLS transcoded output

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/ || exit 1

ENTRYPOINT ["nextflix"]
