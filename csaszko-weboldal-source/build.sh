#!/bin/sh
# Builds the Csaszko Barbershop website program (the site in www/ is compiled into it).
set -e
cd "$(dirname "$0")"
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../adam-csaszko/bin/csaszko-weboldal-linux-$a .
done
echo "Done. Raise the version in adam-csaszko/umbrel-app.yml."
