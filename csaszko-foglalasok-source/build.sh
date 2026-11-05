#!/bin/sh
# Builds the Csaszko Foglalások program for the Umbrel app (Go 1.24+, standard library only).
set -e
cd "$(dirname "$0")"
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../adam-csaszko-foglalasok/bin/csaszko-foglalasok-linux-$a .
done
echo "Done. Raise the version in adam-csaszko-foglalasok/umbrel-app.yml."
