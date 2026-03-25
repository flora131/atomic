FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# Install Bun and OpenCode as the vscode user (both install to $HOME)
USER vscode

RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/home/vscode/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN curl -fsSL https://opencode.ai/install | bash
ENV PATH="/home/vscode/.opencode/bin:${PATH}"

RUN curl -fsSL https://claude.ai/install.sh | bash

RUN curl -fsSL https://gh.io/copilot-install | bash

# Install uv, cocoindex-code, and Playwright CLI
ENV PATH="/home/vscode/.local/bin:${PATH}"
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && uv tool install --upgrade cocoindex-code --prerelease explicit --with "cocoindex>=1.0.0a24"

RUN bun install -g @playwright/cli@latest

# Write cocoindex global settings
RUN mkdir -p /home/vscode/.cocoindex_code \
    && printf 'embedding:\n  model: lightonai/LateOn-Code-edge\n  provider: sentence-transformers\n' \
    > /home/vscode/.cocoindex_code/global_settings.yml
