FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install nono sandbox
RUN VERSION=$(curl -sI https://github.com/always-further/nono/releases/latest | grep -i location | grep -oP 'v\K[0-9.]+') \
    && ARCH=$(dpkg --print-architecture) \
    && wget https://github.com/always-further/nono/releases/download/v${VERSION}/nono-cli_${VERSION}_${ARCH}.deb \
    && dpkg -i nono-cli_${VERSION}_${ARCH}.deb \
    && rm nono-cli_${VERSION}_${ARCH}.deb

# Copy aggregated nono profile (covers all agents)
RUN mkdir -p /etc/nono/profiles
COPY nono-profile.json /etc/nono/profiles/atomic-dev.json

ENTRYPOINT ["nono", "shell", "--silent", "--profile", "/etc/nono/profiles/atomic-dev.json", "--allow-cwd"]
