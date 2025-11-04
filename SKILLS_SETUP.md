# Skills Setup Guide

Add Claude Skills support to your AI coding agent (Codex, Cursor, Windsurf, or GitHub Copilot).

**Note:** Claude Code has native skills support - no setup needed.

## Prerequisites

- **uv installed**: Python package runner ([install guide](https://github.com/astral-sh/uv))
- **~/bin in PATH**: Or use alternative location like `/usr/local/bin`
- **Git installed**: For cloning the skills repository
- **Shell profile**: Access to `~/.zshrc` or `~/.bashrc` to set environment variables

---

## Quick Start (3 Steps)

### 1. Clone Skills Repository

Choose your agent and run the corresponding command:

**For Codex:**
```bash
git clone https://github.com/anthropics/anthropic-skills ~/.codex/skills
```

**For Cursor:**
```bash
git clone https://github.com/anthropics/anthropic-skills ~/.cursor/skills
```

**For Windsurf:**
```bash
git clone https://github.com/anthropics/anthropic-skills ~/.windsurf/skills
```

**For GitHub Copilot:**
```bash
git clone https://github.com/anthropics/anthropic-skills ~/.github/skills
```

### 2. Install list-skills Script

From the agent-instructions repository root:

```bash
cp scripts/list-skills ~/bin/list-skills
chmod +x ~/bin/list-skills
```

**Alternative:** If `~/bin` is not in your PATH, use `/usr/local/bin`:
```bash
sudo cp scripts/list-skills /usr/local/bin/list-skills
sudo chmod +x /usr/local/bin/list-skills
```

### 3. Set Environment Variable

Add to your shell profile (`~/.zshrc` for Zsh or `~/.bashrc` for Bash):

**For Codex:**
```bash
export AGENT_SKILLS_DIR="$HOME/.codex/skills"
```

**For Cursor:**
```bash
export AGENT_SKILLS_DIR="$HOME/.cursor/skills"
```

**For Windsurf:**
```bash
export AGENT_SKILLS_DIR="$HOME/.windsurf/skills"
```

**For GitHub Copilot:**
```bash
export AGENT_SKILLS_DIR="$HOME/.github/skills"
```

Then reload your shell:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

---

## Agent-Specific Configuration

After completing the Quick Start, follow your agent's specific setup:

### Codex

Codex reads `AGENTS.md` directly. No additional configuration needed.

**Verification:**
1. Start Codex in a project with `AGENTS.md`
2. Codex should automatically run `list-skills` and enumerate skills

### Cursor

Link AGENTS.md to Cursor's configuration file:

```bash
# In your project root
cp AGENTS.md .cursorrules
```

**Verification:**
1. Open project in Cursor
2. Cursor should read `.cursorrules` and run `list-skills`

### Windsurf

Link AGENTS.md to Windsurf's configuration file:

```bash
# In your project root
cp AGENTS.md .windsurfrules
```

**Verification:**
1. Open project in Windsurf
2. Windsurf should read `.windsurfrules` and run `list-skills`

### GitHub Copilot

Link AGENTS.md to Copilot's instructions file:

```bash
# In your project root
mkdir -p .github
cp AGENTS.md .github/copilot-instructions.md
```

**Verification:**
1. Open project with GitHub Copilot enabled
2. Copilot should read `.github/copilot-instructions.md` and run `list-skills`

---

## Verification

Test your setup works correctly:

### 1. Check Environment Variable

```bash
echo $AGENT_SKILLS_DIR
```

Expected output: `/Users/yourname/.codex/skills` (or your agent's path)

### 2. Test list-skills Script

```bash
list-skills
```

Expected output: JSON array of skills:
```json
[
  {
    "name": "brainstorming",
    "description": "Transform rough ideas into fully-formed designs...",
    "path": "/Users/yourname/.codex/skills/brainstorming/SKILL.md"
  },
  {
    "name": "systematic-debugging",
    "description": "Four-phase framework for debugging...",
    "path": "/Users/yourname/.codex/skills/systematic-debugging/SKILL.md"
  }
]
```

### 3. Test in Your Agent

Start your agent in a project and ask:
```
"What skills do you have available?"
```

The agent should list the skills from the JSON output.

---

## Troubleshooting

### Error: "missing skills dir"

**Cause:** `AGENT_SKILLS_DIR` not set or points to non-existent directory

**Fix:**
1. Verify env var: `echo $AGENT_SKILLS_DIR`
2. Verify directory exists: `ls $AGENT_SKILLS_DIR`
3. If missing, clone skills repo again (see Quick Start step 1)
4. Reload shell: `source ~/.zshrc`

### Error: "command not found: list-skills"

**Cause:** Script not in PATH

**Fix:**
1. Verify ~/bin in PATH: `echo $PATH | grep bin`
2. If missing, add to shell profile:
   ```bash
   export PATH="$HOME/bin:$PATH"
   ```
3. Reload: `source ~/.zshrc`
4. Verify: `which list-skills`

### Error: "uv: command not found"

**Cause:** uv not installed

**Fix:**
Install uv:
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Agent Doesn't List Skills

**Cause:** Agent not reading AGENTS.md or not executing list-skills

**Fix:**
1. Verify AGENTS.md has skills section (see this repo's AGENTS.md)
2. For Cursor/Windsurf/Copilot, verify config file exists:
   - Cursor: `.cursorrules`
   - Windsurf: `.windsurfrules`
   - Copilot: `.github/copilot-instructions.md`
3. Restart your agent

---

## Multiple Agents on Same Machine

You can use multiple agents on the same machine. Each maintains its own skills directory:

```bash
# Example: Using both Codex and Cursor
~/.codex/skills/        # Codex skills
~/.cursor/skills/       # Cursor skills
```

Each agent's `AGENT_SKILLS_DIR` points to its own directory. No conflicts.

---

## Custom Skills

To add your own skills:

1. Create a directory in your agent's skills folder:
   ```bash
   mkdir -p $AGENT_SKILLS_DIR/my-custom-skill
   ```

2. Create `SKILL.md` with YAML front-matter:
   ```markdown
   ---
   name: my-custom-skill
   description: What this skill does
   ---

   # Skill Instructions

   [Your skill content here]
   ```

3. The skill will automatically appear in `list-skills` output

---

## Updating Skills

To update the anthropic-skills repository:

```bash
cd $AGENT_SKILLS_DIR
git pull origin main
```

Skills are updated immediately - no need to restart your agent.

---

## Additional Resources

- [Anthropic Skills Repository](https://github.com/anthropics/anthropic-skills)
- [Claude Skills Documentation](https://docs.anthropic.com/claude/docs/skills)
- [uv Documentation](https://github.com/astral-sh/uv)
