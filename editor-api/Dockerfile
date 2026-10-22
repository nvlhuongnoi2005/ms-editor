FROM node:22-alpine AS frontend
WORKDIR /src/editor-web
COPY editor-web/package.json editor-web/package-lock.json ./
RUN npm ci
COPY editor-web/ ./
RUN npm run build:react

FROM golang:1.27-alpine AS build
WORKDIR /src/editor-api
COPY editor-api/go.mod editor-api/go.sum ./
RUN go mod download
COPY editor-api/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/editor-api ./cmd/editor-api

FROM alpine:3.22
WORKDIR /app
COPY --from=build /out/editor-api /app/editor-api
COPY --from=frontend /src/editor-web/dist/ /app/dist/
ENV EDITOR_API_ADDR=0.0.0.0:4173
ENV EDITOR_STATIC_ROOT=/app/dist
EXPOSE 4173
ENTRYPOINT ["/app/editor-api"]
