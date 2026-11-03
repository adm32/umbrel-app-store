#!/bin/sh
# Builds the core website program for the Umbrel app (Go 1.24+).
# The website files in www/ are compiled into the program.
set -e
cd "$(dirname "$0")"
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../adam-admcore/bin/weboldal-linux-$a .
done
echo "Done. Raise the version in adam-admcore/umbrel-app.yml and docker-compose.yml."
