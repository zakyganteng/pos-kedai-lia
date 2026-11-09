# Build from project/: docker build -f backend/Dockerfile .
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -o /pos ./cmd/pos

FROM alpine:3.23
RUN apk add --no-cache tzdata
COPY --from=build /pos /pos
USER nobody
EXPOSE 8080
ENTRYPOINT ["/pos"]
CMD ["serve"]
