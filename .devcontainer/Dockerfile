FROM mcr.microsoft.com/devcontainers/base:ubuntu

# ─── System dependencies ─────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm tmux \
    && rm -rf /var/lib/apt/lists/*

# ─── System-wide tools (via multi-stage COPY) ────────────────────────────────
COPY --from=oven/bun:latest /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

USER vscode

# ─── SSH agent forwarding in tmux ────────────────────────────────────────────
RUN mkdir -p ~/.ssh \
    && printf 'if [ -S "$SSH_AUTH_SOCK" ]; then\n    ln -sf "$SSH_AUTH_SOCK" ~/.ssh/agent_sock\nfi\n' \
    > ~/.ssh/rc \
    && chmod 755 ~/.ssh/rc \
    && printf '\n# Keep SSH agent alive in tmux\nif [ -n "$TMUX" ]; then\n    export SSH_AUTH_SOCK=~/.ssh/agent_sock\nelif [ -S "$SSH_AUTH_SOCK" ]; then\n    ln -sf "$SSH_AUTH_SOCK" ~/.ssh/agent_sock\nfi\n' \
    >> ~/.bashrc

# ─── cocoindex-code: install (model downloads on first `ccc search`) ─────────
RUN uv tool install --upgrade cocoindex-code \
    --prerelease explicit --with "cocoindex>=1.0.0a33" \
    && mkdir -p ~/.cocoindex_code \
    && printf 'embedding:\n  model: lightonai/LateOn-Code-edge\n  provider: sentence-transformers\n' \
    > ~/.cocoindex_code/global_settings.yml

# Optional: pre-bake ~200 MB embedding model to avoid first-run download.
# Uncomment to trade build time for faster first `ccc search`.
# RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('lightonai/LateOn-Code-edge'); print('Model cached.')" \
#     || true

# ─── Dev tools ────────────────────────────────────────────────────────────────
RUN bun install -g @playwright/cli@latest

# ─── Coding agents ────────────────────────────────────────────────────────────
RUN curl -fsSL https://opencode.ai/install | bash \
    && curl -fsSL https://claude.ai/install.sh | bash \
    && curl -fsSL https://gh.io/copilot-install | bash

# ─── Runtime defaults (overridable via devcontainer.json remoteEnv) ───────────
# Map index databases to container-native filesystem for better SQLite
# performance on cross-OS volume mounts (macOS / Windows hosts).
ENV COCOINDEX_CODE_DB_PATH_MAPPING=/workspaces=/tmp/cocoindex-db