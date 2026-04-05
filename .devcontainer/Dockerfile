FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install nono sandbox
RUN apt-get update \
    && VERSION=$(curl -sI https://github.com/always-further/nono/releases/latest | grep -i location | grep -oP 'v\K[0-9.]+') \
    && ARCH=$(dpkg --print-architecture) \
    && wget https://github.com/always-further/nono/releases/download/v${VERSION}/nono-cli_${VERSION}_${ARCH}.deb \
    && apt-get install -y --no-install-recommends ./nono-cli_${VERSION}_${ARCH}.deb libdbus-1-3 \
    && rm nono-cli_${VERSION}_${ARCH}.deb \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/nono/profiles

COPY nono-profile.json /etc/nono/profiles/atomic-dev.json

# USER vscode
# ENTRYPOINT ["nono", "shell", "--silent", "--profile", "/etc/nono/profiles/atomic-dev.json", "--allow-cwd"]
