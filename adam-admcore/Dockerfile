# core (admcore.hu) – Umbrel / Docker image.
# Copies the prebuilt static program (the website is compiled into it),
# so the image builds on the Umbrel itself without internet.
FROM scratch
ARG TARGETARCH=amd64
COPY bin/weboldal-linux-${TARGETARCH} /weboldal
ENV DATA_DIR=/data PORT=8080 TZ=Europe/Budapest
EXPOSE 8080
USER 1000:1000
ENTRYPOINT ["/weboldal"]
