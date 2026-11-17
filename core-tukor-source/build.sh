#!/bin/sh
# Builds Tükör for the Umbrel app (Go 1.24+). The page and icon in www/ are compiled in.
set -e
cd "$(dirname "$0")"
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../adam-tukor/bin/tukor-linux-$a .
done
echo "Done. Raise the version in adam-tukor/umbrel-app.yml and docker-compose.yml."
