#!/bin/bash

# Skills Installation Script
# Install skills for Claude Code, Cursor, Copilot, or Windsurf

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

install_claude_code() {
    print_info "Installing Claude Code skills..."

    # Create skills directory
    mkdir -p "$HOME/.claude/skills"

    # Symlink each skill
    for skill_dir in "$SCRIPT_DIR/claude-code"/*/ ; do
        skill_name=$(basename "$skill_dir")

        if [ -L "$HOME/.claude/skills/$skill_name" ]; then
            print_info "Skill '$skill_name' already symlinked, skipping"
        elif [ -d "$HOME/.claude/skills/$skill_name" ]; then
            print_error "Directory '$skill_name' already exists (not a symlink)"
            print_info "Remove it manually or backup before installing"
        else
            ln -s "$skill_dir" "$HOME/.claude/skills/$skill_name"
            print_success "Installed skill: $skill_name"
        fi
    done

    print_success "Claude Code skills installed to ~/.claude/skills/"
    print_info "Restart Claude Code to load skills"
}

install_cursor() {
    print_info "Installing Cursor rules..."

    # Check if we're in a project directory
    if [ ! -d ".git" ]; then
        print_error "Not in a git repository root. Navigate to your project root first."
        exit 1
    fi

    # Create .cursor/rules directory
    mkdir -p .cursor/rules

    # Copy rules
    cp "$SCRIPT_DIR/cursor"/*.cursorrules .cursor/rules/

    print_success "Cursor rules installed to .cursor/rules/"
    print_info "Rules will be automatically loaded by Cursor"
}

install_copilot() {
    print_info "Installing GitHub Copilot instructions..."

    # Check if we're in a project directory
    if [ ! -d ".git" ]; then
        print_error "Not in a git repository root. Navigate to your project root first."
        exit 1
    fi

    # Create .github directory
    mkdir -p .github

    # Combine all instructions
    cat "$SCRIPT_DIR/copilot"/*.md > .github/copilot-instructions.md

    print_success "Copilot instructions installed to .github/copilot-instructions.md"
    print_info "Commit this file to share with your team"
}

install_windsurf() {
    print_info "Installing Windsurf rules..."

    # Check if we're in a project directory
    if [ ! -d ".git" ]; then
        print_error "Not in a git repository root. Navigate to your project root first."
        exit 1
    fi

    # Create .windsurf directory
    mkdir -p .windsurf

    # Combine all rules
    cat "$SCRIPT_DIR/windsurf"/*.md > .windsurf/rules.md

    print_success "Windsurf rules installed to .windsurf/rules.md"
    print_info "You can also add these via Windsurf Settings → Rules"
}

install_all() {
    print_info "Installing skills for all agents..."
    echo ""

    install_claude_code
    echo ""

    if [ -d ".git" ]; then
        install_cursor
        echo ""
        install_copilot
        echo ""
        install_windsurf
    else
        print_info "Skipping project-specific installations (Cursor, Copilot, Windsurf)"
        print_info "Navigate to a project directory and run:"
        print_info "  ./skills/install.sh cursor"
        print_info "  ./skills/install.sh copilot"
        print_info "  ./skills/install.sh windsurf"
    fi
}

show_usage() {
    cat << EOF
Usage: ./skills/install.sh [AGENT]

Install skills for AI coding agents.

AGENTS:
  claude-code    Install skills to ~/.claude/skills/ (symlinked)
  cursor         Install rules to .cursor/rules/ (current project)
  copilot        Install instructions to .github/copilot-instructions.md (current project)
  windsurf       Install rules to .windsurf/rules.md (current project)
  all            Install for all agents

EXAMPLES:
  ./skills/install.sh claude-code    # Install Claude Code skills globally
  ./skills/install.sh cursor         # Install Cursor rules in current project
  ./skills/install.sh all            # Install for all agents

NOTE:
  - Claude Code: Installs globally (works for all projects)
  - Cursor, Copilot, Windsurf: Install in current project directory
EOF
}

# Main script logic
case "${1:-}" in
    claude-code)
        install_claude_code
        ;;
    cursor)
        install_cursor
        ;;
    copilot)
        install_copilot
        ;;
    windsurf)
        install_windsurf
        ;;
    all)
        install_all
        ;;
    -h|--help|help)
        show_usage
        ;;
    "")
        print_error "No agent specified"
        echo ""
        show_usage
        exit 1
        ;;
    *)
        print_error "Unknown agent: $1"
        echo ""
        show_usage
        exit 1
        ;;
esac
