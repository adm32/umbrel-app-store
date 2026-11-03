#!/bin/sh
# Builds the core Irányítópult program for the Umbrel app (Go 1.24+).
set -e
cd "$(dirname "$0")"
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../adam-core-iranyitopult/bin/iranyitopult-linux-$a .
done
echo "Done. Raise the version in adam-core-iranyitopult/umbrel-app.yml."
