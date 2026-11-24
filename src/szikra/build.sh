#!/bin/sh
# Builds Szikra (study app). The page (web/) and the study material (content/) are compiled in.
# Output: ../../adam-szikra/bin/szikra-linux-amd64 and -arm64 (what the Umbrel app runs).
# New study material: add a JSON file to content/<subject>/ (see content/README.md), then build.
# After building: raise `version` in adam-szikra/umbrel-app.yml and `const version` in main.go
# (the page reloads itself when it sees a new version), add a release note, commit, push.
set -e
cd "$(dirname "$0")"
go vet ./...
go test ./... >/dev/null
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../../adam-szikra/bin/szikra-linux-$a .
done
echo "Done: adam-szikra/bin/. Now raise the version in adam-szikra/umbrel-app.yml."
