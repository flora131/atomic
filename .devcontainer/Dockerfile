FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

ARG BUN_VERSION=1.3.10

# Install Bun and OpenCode as the vscode user (both install to $HOME)
USER vscode

RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}"
ENV BUN_INSTALL="/home/vscode/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path
ENV PATH="/home/vscode/.opencode/bin:${PATH}"

# Install Claude Code and Copilot CLI as root (both install to /usr/local/bin)
USER root

RUN curl -fsSL https://claude.ai/install.sh | bash

RUN curl -fsSL https://gh.io/copilot-install | bash
