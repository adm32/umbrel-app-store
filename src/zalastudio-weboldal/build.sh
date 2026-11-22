#!/bin/sh
# Builds Zala Studio weboldal (zalastudio.hu).
# The website files in www/ are compiled into the program.
# Output: ../../adam-admcore/bin/weboldal-linux-amd64 and -arm64 (what the Umbrel app runs).
# After building: raise `version` in adam-admcore/umbrel-app.yml (and APP_VERSION in its
# docker-compose.yml if it has one), add a release note, commit, push.
set -e
cd "$(dirname "$0")"
go vet ./...
go test ./... >/dev/null
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../../adam-admcore/bin/weboldal-linux-$a .
done
echo "Done: adam-admcore/bin/. Now raise the version in adam-admcore/umbrel-app.yml."
