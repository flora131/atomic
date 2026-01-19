# Atomic

<p align="center">
  <img src="assets/atomic.png" alt="Atomic" width="800">
</p>

AI coding agents need context and procedures. Atomic provides both.

- **Procedures**: Automated workflows for research → spec → implement → PR
- **Memory**: Specs persist as documentation for future sessions

---

## Video Overview

[![Atomic Video Overview](https://img.youtube.com/vi/Lq8-qzGfoy4/maxresdefault.jpg)](https://www.youtube.com/watch?v=Lq8-qzGfoy4)

---

## The Flywheel

```
Research → Specs → Execution → Outcomes → Specs (persistent memory)
                ↑                                    ↓
                └────────────────────────────────────┘
```

Every feature follows this cycle. Specs become memory for future sessions.

---

## How It Works

[![Architecture](assets/architecture.svg)](assets/architecture.svg)

| Resource     | Purpose            | Examples                                                   |
| ------------ | ------------------ | ---------------------------------------------------------- |
| **Commands** | Orchestrate agents | `/research-codebase`, `/create-spec`, `/implement-feature` |
| **Agents**   | Execute tasks      | `codebase-analyzer`, `codebase-locator`, `debugger`        |
| **Skills**   | Domain knowledge   | `testing-anti-patterns`, `prompt-engineer`                 |

---

## Quick Start

```bash
# Using bun (recommended)
bunx @bastani/atomic

# Or using npx
npx @bastani/atomic
```

Select your agent. The CLI configures your project automatically.

### Prerequisites

- [bun](https://bun.sh/docs/installation) or Node.js 18+
- Coding agent installed: [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup), [OpenCode](https://opencode.ai), or [GitHub Copilot CLI](https://github.com/github/copilot-cli)

---

## The Workflow

```
Research → Spec → Features → Implement (Ralph) → PR
```

### 1. Research the Codebase

```bash
atomic --agent claude-code /research-codebase "Describe your feature or question"
```

**You review:** Confirm the agent understood your codebase and requirements.

### 2. Create a Specification

```bash
atomic --agent claude-code /create-spec research/
```

**You review (CRITICAL):** This is your main decision point. The spec becomes the contract.

### 3. Break Into Features

```bash
atomic --agent claude-code /create-feature-list specs/your-spec.md
```

**You review:** Verify the breakdown makes sense. Reorder if needed.

### 4. Implement Features

```bash
atomic --agent claude-code /implement-feature
```

Repeat until all features pass. Use `/ralph-loop` for autonomous mode. More in [Ralph Section](#autonomous-execution-ralph).

### 5. Create Pull Request

```bash
atomic --agent claude-code /create-gh-pr
```

---

## Commands

| Command                | Arguments              | Description                            |
| ---------------------- | ---------------------- | -------------------------------------- |
| `/research-codebase`   | `[question]`           | Analyze codebase and document findings |
| `/create-spec`         | `[research-path]`      | Generate technical specification       |
| `/create-feature-list` | `[spec-path]`          | Break spec into implementable tasks    |
| `/implement-feature`   | —                      | Implement next feature from list       |
| `/commit`              | `[message]`            | Create conventional commit             |
| `/create-gh-pr`        | —                      | Push and create pull request           |
| `/explain-code`        | `[path]`               | Explain code section in detail         |
| `/ralph-loop`          | `[--max-iterations N]` | Run autonomous implementation loop     |
| `/cancel-ralph`        | —                      | Stop autonomous loop                   |
| `/ralph-help`          | —                      | Show Ralph documentation               |

---

## Supported Agents

| Agent              | CLI Command                  | Folder       | Context File |
| ------------------ | ---------------------------- | ------------ | ------------ |
| Claude Code        | `atomic --agent claude-code` | `.claude/`   | `CLAUDE.md`  |
| OpenCode           | `atomic --agent opencode`    | `.opencode/` | `AGENTS.md`  |
| GitHub Copilot CLI | `atomic --agent copilot-cli` | `.github/`   | `AGENTS.md`  |

---

## Autonomous Execution (Ralph)

<p align="center">
  <img src="https://external-content.duckduckgo.com/iu/?u=https%3A%2F%2Fstatic1.srcdn.com%2Fwordpress%2Fwp-content%2Fuploads%2F2020%2F04%2Fralph-wiggum-simpsons-featured-1710x900.jpg&f=1&nofb=1&ipt=ecf7c217c4b33bb1f7564b75742bf937c088be5119449639a24411350a275f94" alt="Ralph Wiggum" width="600">
</p>

The [Ralph Wiggum Method](https://ghuntley.com/ralph/) enables multi-hour autonomous coding sessions. After approving your spec and feature list, let Ralph work in the background while you focus on other tasks.

### How It Works

1. Create and approve your spec (`/create-spec`)
2. Generate feature list (`/create-feature-list`)
3. Start autonomous loop (`/ralph-loop`)
4. Ralph implements features one-by-one until complete

### Commands

| Command                           | Description                          |
| --------------------------------- | ------------------------------------ |
| `/ralph-loop`                     | Start autonomous implementation loop |
| `/ralph-loop --max-iterations 20` | Limit to 20 iterations               |
| `/cancel-ralph`                   | Stop the autonomous loop             |
| `/ralph-help`                     | Show Ralph documentation             |

### Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) - Python package manager (for Ralph scripts)
- Currently supported: Claude Code (Mac/Linux and Windows PowerShell)

---

## What's Included

**7 Agents** | **10 Commands** | **2 Skills**

- **Agents**: codebase-analyzer, codebase-locator, codebase-online-researcher, codebase-pattern-finder, codebase-research-analyzer, codebase-research-locator, debugger
- **Skills**: prompt-engineer, testing-anti-patterns

---

## Troubleshooting

**Git Identity Error:** Configure git identity:
```bash
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

---

## License

MIT

## Credits

- [Superpowers](https://github.com/obra/superpowers)
- [Anthropic Skills](https://github.com/anthropics/skills)
- [Ralph Wiggum Method](https://ghuntley.com/ralph/)
- [OpenAI Codex Cookbook](https://github.com/openai/openai-cookbook)
- [HumanLayer](https://github.com/humanlayer/humanlayer)
