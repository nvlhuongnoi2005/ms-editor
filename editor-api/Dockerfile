FROM node:22-alpine AS frontend
WORKDIR /src/editor-web
COPY editor-web/package.json editor-web/package-lock.json ./
RUN npm ci
COPY editor-web/ ./
# The symbol catalogue imports atlas JSON outside editor-web at build time.
COPY ENC/sprites/ /src/ENC/sprites/
RUN npm run build:react

FROM golang:1.27-alpine AS build
WORKDIR /src/editor-api
COPY editor-api/go.mod editor-api/go.sum ./
RUN go mod download
COPY editor-api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/editor-api ./cmd/editor-api

FROM iboates/osm2pgsql@sha256:6548a1e2492e08fa0d5ce987d382ad57c4b21c8a94ff00017c6109770a061b79 AS render-worker
WORKDIR /app
COPY --from=build /out/editor-api /app/editor-api
ENV EDITOR_MODE=render-worker
ENTRYPOINT ["/app/editor-api"]

# Keep the HTTP application last: docker build without --target must start the UI/API.
FROM alpine:3.22 AS app
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/editor-api /app/editor-api
COPY --from=frontend /src/editor-web/dist/ /app/dist/
COPY ENC/sprites/ /app/enc/sprites/
COPY ENC/fonts/ /app/enc/fonts/
ENV EDITOR_API_ADDR=0.0.0.0:4173
ENV EDITOR_STATIC_ROOT=/app/dist
ENV EDITOR_ENC_ASSETS_ROOT=/app/enc
EXPOSE 4173
ENTRYPOINT ["/app/editor-api"]
