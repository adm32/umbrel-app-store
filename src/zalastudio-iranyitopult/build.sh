#!/bin/sh
# Builds Zala Studio Irányítópult (leads, payments, tax).
# The app pages in web/ are compiled into the program.
# Output: ../../adam-core-iranyitopult/bin/iranyitopult-linux-amd64 and -arm64 (what the Umbrel app runs).
# After building: raise `version` in adam-core-iranyitopult/umbrel-app.yml (and APP_VERSION in its
# docker-compose.yml if it has one), add a release note, commit, push.
set -e
cd "$(dirname "$0")"
# web/preview.js is a copy of the website planner preview: always take it from the website, never edit it here.
sed 's/(w || 2)/(w || 1.9)/' ../zalastudio-weboldal/www/assets/js/preview.js > web/preview.js
go vet ./...
go test ./... >/dev/null
for a in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH=$a go build -trimpath -ldflags "-s -w" -o ../../adam-core-iranyitopult/bin/iranyitopult-linux-$a .
done
echo "Done: adam-core-iranyitopult/bin/. Now raise the version in adam-core-iranyitopult/umbrel-app.yml."
