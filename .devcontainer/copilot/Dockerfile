FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install nono sandbox
RUN apt-get update && apt-get install -y nono \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy nono profile (custom profile with ~/.copilot read-write access)
RUN mkdir -p /etc/nono/profiles
COPY nono-profile.json /etc/nono/profiles/atomic-copilot.json

ENTRYPOINT ["nono", "shell", "--profile", "/etc/nono/profiles/atomic-copilot.json", "--allow-cwd"]
