# Tükör – Umbrel / Docker image. Copies the prebuilt static program, so the image builds on
# the Umbrel itself without internet. Runs as root: it starts/stops the other apps through
# Docker and writes their data folders (keeping each file's owner).
FROM scratch
ARG TARGETARCH=amd64
COPY bin/tukor-linux-${TARGETARCH} /tukor
ENV DATA_DIR=/data APPS_DIR=/app-data TZ=Europe/Budapest
ENTRYPOINT ["/tukor"]
