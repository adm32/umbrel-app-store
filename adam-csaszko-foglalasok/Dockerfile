# Csaszko Foglalások – Umbrel / Docker image.
# Copies the prebuilt static program (the admin app is compiled into it),
# so the image builds on the Umbrel itself without internet.
FROM scratch
ARG TARGETARCH=amd64
COPY bin/csaszko-foglalasok-linux-${TARGETARCH} /foglalasok
ENV DATA_DIR=/data ADMIN_PORT=8080 PUBLIC_PORT=3001 REMOTE_PORT=8082 TZ=Europe/Budapest
EXPOSE 8080 3001 8082
USER 1000:1000
ENTRYPOINT ["/foglalasok"]
