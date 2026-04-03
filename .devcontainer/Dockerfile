FROM mcr.microsoft.com/devcontainers/base:ubuntu

# ─── Install tmux ────────────────────────────────────────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends tmux \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL --retry 3 --retry-delay 5 https://opencode.ai/install | bash \
    && curl -fsSL --retry 3 --retry-delay 5 https://gh.io/copilot-install | bash \
    && curl -fsSL --retry 3 --retry-delay 5 https://claude.ai/install.sh | bash

# ─── SSH agent forwarding in tmux ────────────────────────────────────────────
RUN mkdir -p ~/.ssh \
    && printf 'if [ -S "$SSH_AUTH_SOCK" ]; then\n    ln -sf "$SSH_AUTH_SOCK" ~/.ssh/agent_sock\nfi\n' \
    > ~/.ssh/rc \
    && chmod 755 ~/.ssh/rc \
    && printf '\n# Keep SSH agent alive in tmux\nif [ -n "$TMUX" ]; then\n    export SSH_AUTH_SOCK=~/.ssh/agent_sock\nelif [ -S "$SSH_AUTH_SOCK" ]; then\n    ln -sf "$SSH_AUTH_SOCK" ~/.ssh/agent_sock\nfi\n' \
    >> ~/.bashrc