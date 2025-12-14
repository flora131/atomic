FROM oven/bun:latest

ARG TZ
ENV TZ="$TZ"

ARG CLAUDE_CODE_VERSION=latest

# Install basic development tools and iptables/ipset
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    build-essential \
    bash \
    curl \
    less \
    git \
    openssh-client \
    pkg-config \
    libssl-dev \
    procps \
    sudo \
    fzf \
    zsh \
    man-db \
    unzip \
    gnupg2 \
    gh \
    iptables \
    ipset \
    iproute2 \
    dnsutils \
    aggregate \
    jq \
    nano \
    vim \
    wget \
    tar \
    xz-utils \
    libicu-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install multiple .NET SDK versions (8/9/10) via Microsoft's official dotnet-install script.
# https://builds.dotnet.microsoft.com/dotnet/scripts/v1/dotnet-install.sh
RUN curl -fsSL https://builds.dotnet.microsoft.com/dotnet/scripts/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
    && chmod +x /tmp/dotnet-install.sh \
    && /tmp/dotnet-install.sh --channel 10.0 --install-dir /usr/share/dotnet \
    && /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet \
    && /tmp/dotnet-install.sh --channel 8.0 --install-dir /usr/share/dotnet \
    && rm -f /tmp/dotnet-install.sh

# Install uv (latest) into /usr/local/bin
# https://astral.sh/uv
RUN curl -fsSL https://astral.sh/uv/install.sh -o /tmp/uv-install.sh \
    && UV_UNMANAGED_INSTALL=/usr/local/bin sh /tmp/uv-install.sh \
    && rm -f /tmp/uv-install.sh \
    && uv --version

ARG USERNAME=bun
ENV HOME=/home/${USERNAME}

# XDG Base Directory spec
ENV XDG_CONFIG_HOME=${HOME}/.config
ENV XDG_CONFIG_DIRS=/etc/xdg
ENV XDG_CACHE_HOME=${HOME}/.cache
ENV XDG_DATA_HOME=${HOME}/.local/share
ENV XDG_DATA_DIRS=/usr/local/share:/usr/share
ENV XDG_STATE_HOME=${HOME}/.local/state
ENV XDG_BIN_HOME=${HOME}/.local/bin

# Give bun (and other tooling) a guaranteed user-writable temp directory.
# Bun resolves temp dir in this order: BUN_TMPDIR, TMPDIR, TEMP, TMP, then platform default (/tmp on Linux).
# Using /tmp is the most robust choice in devcontainers (works even if $HOME is remapped or mounted oddly).
ENV TMPDIR=/tmp
ENV TEMP=/tmp
ENV TMP=/tmp
ENV BUN_TMPDIR=/tmp

ENV DOTNET_ROOT=/usr/share/dotnet
ENV DOTNET_MULTILEVEL_LOOKUP=0

# Rust toolchain locations (installed via rustup as the non-root user)
ENV CARGO_HOME=${HOME}/.cargo
ENV RUSTUP_HOME=${HOME}/.rustup

# Ensure user-local binaries (uv python, etc.) are available.
ENV PATH=${DOTNET_ROOT}:${CARGO_HOME}/bin:${XDG_BIN_HOME}:${PATH}

# Persist bash history.
RUN SNIPPET="export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" \
    && mkdir /commandhistory \
    && touch /commandhistory/.bash_history \
    && chown -R $USERNAME /commandhistory

# Set `DEVCONTAINER` environment variable to help with orientation
ENV DEVCONTAINER=true

# Create workspace and config directories
RUN mkdir -p /workspace $HOME/.claude && \
    chown -R ${USERNAME}:${USERNAME} /workspace $HOME/.claude

WORKDIR /workspace

ARG GIT_DELTA_VERSION=0.18.2
RUN ARCH=$(dpkg --print-architecture) && \
    wget "https://github.com/dandavison/delta/releases/download/${GIT_DELTA_VERSION}/git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    dpkg -i "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb" && \
    rm "git-delta_${GIT_DELTA_VERSION}_${ARCH}.deb"

# Set up non-root user
USER bun

# Configure git defaults for the dev user
COPY --chown=bun:bun config/.gitconfig $HOME/.gitconfig

# Pre-install multiple Python versions for the dev user via uv
RUN uv python install 3.10 3.11 3.12 3.13 3.14

# Install latest stable Rust (via rustup) for the non-root user
ARG RUSTUP_TOOLCHAIN=stable
RUN curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain ${RUSTUP_TOOLCHAIN} && \
    rustup component add rustfmt clippy

# Set the default shell to zsh rather than sh
ENV SHELL=/bin/zsh

# Set the default editor and visual
ENV EDITOR=nano
ENV VISUAL=nano

# Install starship prompt (must be done as root for /usr/local/bin)
USER root
RUN curl -sS https://starship.rs/install.sh | sh -s -- --yes
USER bun

# Copy starship config
RUN mkdir -p $HOME/.config/starship
COPY --chown=bun:bun config/starship/starship.toml $HOME/.config/starship/starship.toml

# Configure zsh with starship
RUN echo 'source /usr/share/doc/fzf/examples/key-bindings.zsh' >> $HOME/.zshrc && \
    echo 'source /usr/share/doc/fzf/examples/completion.zsh' >> $HOME/.zshrc && \
    echo "export PROMPT_COMMAND='history -a' && export HISTFILE=/commandhistory/.bash_history" >> $HOME/.zshrc && \
    echo 'export XDG_CONFIG_HOME="$HOME/.config"' >> $HOME/.zshrc && \
    echo 'export XDG_CONFIG_DIRS=/etc/xdg' >> $HOME/.zshrc && \
    echo 'export XDG_CACHE_HOME="$HOME/.cache"' >> $HOME/.zshrc && \
    echo 'export XDG_DATA_HOME="$HOME/.local/share"' >> $HOME/.zshrc && \
    echo 'export XDG_DATA_DIRS=/usr/local/share:/usr/share' >> $HOME/.zshrc && \
    echo 'export XDG_STATE_HOME="$HOME/.local/state"' >> $HOME/.zshrc && \
    echo 'export XDG_BIN_HOME="$HOME/.local/bin"' >> $HOME/.zshrc && \
    echo 'export PATH="$XDG_BIN_HOME:$PATH"' >> $HOME/.zshrc && \
    echo 'export STARSHIP_CONFIG=$HOME/.config/starship/starship.toml' >> $HOME/.zshrc && \
    echo 'eval "$(starship init zsh)"' >> $HOME/.zshrc

# Install Claude globally and Playwright browsers as root
USER root
RUN bun install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

# Copy and set up firewall script
COPY config/init-firewall.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-firewall.sh

# Grant bun user passwordless sudo (standard for devcontainers)
RUN echo "bun ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/bun && \
    chmod 0440 /etc/sudoers.d/bun

# Fix ownership of bun user directories (cache dirs are volume-mounted in devcontainer.json)
RUN mkdir -p /home/bun/.cache/starship /home/bun/.bun/install/cache && \
    chown -R bun:bun /home/bun/.cache /home/bun/.bun

USER bun
