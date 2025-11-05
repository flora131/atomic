# Skills Setup - Agent Instructions

This document tells you, the AI coding agent, how to automatically set up skills support for users.

**IMPORTANT:** When a user asks to set up skills, execute all steps automatically like running a setup script. Only ask which agent they're using, then execute all remaining steps automatically without waiting for approval.

**Note:** Claude Code has native skills support - no setup needed. If your user is using Claude Code, inform them this setup is not necessary.

## Your Role

When a user asks to "set up skills @SKILLS_SETUP.md" or "install skills support", **execute the setup automatically like a setup script**:

1. **Ask which agent** they're using (Codex, Cursor, Windsurf, or GitHub Copilot)
2. **Then execute all remaining steps automatically** - don't wait for approval between steps
3. **Run each command** using the Bash tool
4. **Report progress** as you go
5. **Verify at the end** that everything works

**Think of this as running `./setup-skills.sh` - once the user confirms they want to proceed, you execute through all steps automatically.**

**Note:** This setup is only for the skills system itself (cloning the skills repo and installing the list-skills script). Setting up agent config files like .cursorrules or .windsurfrules is handled separately.

---

## Setup Steps

**Execute these steps in order automatically. Do NOT wait for user approval between steps.**

### Step 1: Detect Agent & Clone Skills Repositories

Ask the user which AI coding agent they're using, then proceed with cloning automatically:
- **Codex**: `~/.codex/skills`
- **Cursor**: `~/.cursor/skills`
- **Windsurf**: `~/.windsurf/skills`
- **GitHub Copilot**: `~/.github/skills`

Create a skills directory and clone both the Superpowers and Anthropic skills repositories as subdirectories.

**Example for Cursor:**

First, create the skills directory:
```bash
mkdir -p ~/.cursor/skills
```

Then, clone both repositories:
```bash
git clone https://github.com/obra/superpowers.git ~/.cursor/skills/superpowers
git clone https://github.com/anthropics/skills.git ~/.cursor/skills/anthropic-skills
```

Use the appropriate path for their agent (replace `~/.cursor` with `~/.codex`, `~/.windsurf`, or `~/.github` as needed).

If a directory already exists, inform the user and skip (don't re-clone).

**Note:** The `list-skills` script recursively searches for `SKILL.md` files in the provided skills directory, so both repositories will be automatically discovered.

### Step 2: Install list-skills Script

Install the list-skills script to a location in the user's PATH.

**Prerequisites:** The script requires Node.js (which is typically already installed on development machines).

**The script is located at `scripts/list-skills.js` in the current repository (agent-instructions).**

**Choose installation location:**

Check if ~/bin is in PATH:
```bash
echo $PATH | grep -q "$HOME/bin" && echo "~/bin is in PATH" || echo "~/bin not in PATH"
```

**Option A: Install to ~/bin (recommended for single user)**

If ~/bin is already in PATH:
```bash
mkdir -p ~/bin
cp scripts/list-skills.js ~/bin/list-skills
chmod +x ~/bin/list-skills
```

If ~/bin is NOT in PATH, add it first, then install:

1. Detect user's shell:
```bash
echo $SHELL
```

2. Add ~/bin to PATH based on shell type:

**For zsh (default on modern Macs):**
```bash
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
cp scripts/list-skills.js ~/bin/list-skills
chmod +x ~/bin/list-skills
```

**For bash:**
```bash
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
cp scripts/list-skills.js ~/bin/list-skills
chmod +x ~/bin/list-skills
```

**For bash on macOS (login shell):**
```bash
mkdir -p ~/bin
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bash_profile
source ~/.bash_profile
cp scripts/list-skills.js ~/bin/list-skills
chmod +x ~/bin/list-skills
```

**Option B: Install to /usr/local/bin (system-wide, requires sudo)**
```bash
sudo cp scripts/list-skills.js /usr/local/bin/list-skills
sudo chmod +x /usr/local/bin/list-skills
```

**Note:** /usr/local/bin is already in PATH on most systems and doesn't require shell config changes. This is simpler but requires admin privileges.

### Step 3: Verify Setup

After completing all setup steps, automatically verify everything is working:

**Test list-skills script:**

For the agent you set up, test with the absolute path to the skills directory:
- **Cursor:** `list-skills ~/.cursor/skills`
- **Windsurf:** `list-skills ~/.windsurf/skills`
- **Codex:** `list-skills ~/.codex/skills`
- **GitHub Copilot:** `list-skills ~/.github/skills`

Expected: Should print JSON array of available skills

**Example output:**
```json
[
  {
    "name": "brainstorming",
    "description": "Transform rough ideas into fully-formed designs...",
    "path": "/Users/username/.cursor/skills/brainstorming/SKILL.md"
  }
]
```

**Report results:**
- If all tests pass: "✅ Skills setup complete! You now have X skills available."
- If any test fails: Help troubleshoot using the Troubleshooting section below

---

## Troubleshooting Common Issues

If setup verification fails, help the user debug:

### Error: "missing skills dir"

**Diagnosis:**

For the agent you're using, check if the skills directory exists:
- **Cursor:** `ls ~/.cursor/skills`
- **Windsurf:** `ls ~/.windsurf/skills`
- **Codex:** `ls ~/.codex/skills`
- **GitHub Copilot:** `ls ~/.github/skills`

**Possible causes:**
- Skills directory doesn't exist
- Wrong path specified

**Fix:**
1. Verify the skills directory was created during setup
2. If directory is missing, re-run the git clone command from Step 1

### Error: "command not found: list-skills"

**Diagnosis:**
```bash
which list-skills
echo $PATH | grep bin
```

**Possible causes:**
- Script not copied to PATH location
- ~/bin not in PATH
- Permissions issue

**Fix:**
1. Verify the script exists: `ls -l ~/bin/list-skills` or `ls -l /usr/local/bin/list-skills`
2. Check permissions: `chmod +x ~/bin/list-skills`
3. If ~/bin not in PATH, you have two options:

**Option A: Add ~/bin to PATH permanently**

First, detect which shell the user is using:
```bash
echo $SHELL
```

Then add ~/bin to PATH in the appropriate config file:

**For zsh (default on modern Macs):**
```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**For bash:**
```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**For bash on macOS (login shell):**
```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bash_profile
source ~/.bash_profile
```

**For fish:**
```bash
fish_add_path ~/bin
```

**Option B: Use /usr/local/bin instead**
```bash
sudo cp scripts/list-skills.js /usr/local/bin/list-skills
sudo chmod +x /usr/local/bin/list-skills
```
This location is already in PATH on most systems and doesn't require shell config changes.

### Error: "node: command not found"

**Fix:**

The list-skills script requires Node.js. If you don't have it installed (rare for development machines), install from https://nodejs.org/.

### Agent Can't Access Skills

**Possible causes:**
- Agent not reading AGENTS.md file
- Agent config file not set up (separate from skills setup)
- `list-skills` command not working

**Fix:**
1. Verify AGENTS.md exists in the project root
2. Check if agent-specific config file is needed (e.g., `.cursorrules` for Cursor)
3. Test `list-skills` manually with the appropriate path (e.g., `list-skills ~/.codex/skills`)

**Note:** Setting up agent config files (.cursorrules, .windsurfrules, etc.) is separate from skills setup. See the main setup documentation for that.

---

## Additional Information

Share these tips with users as needed:

### Multiple Agents

Users can set up multiple agents on the same machine. Each agent gets its own skills directory:
- Codex: `~/.codex/skills/`
- Cursor: `~/.cursor/skills/`
- Windsurf: `~/.windsurf/skills/`
- GitHub Copilot: `~/.github/skills/`

All agents can coexist and share the same `list-skills` script installation.

### Custom Skills

Users can create their own skills in their agent's skills directory:

**Example for Cursor:**
```bash
mkdir -p ~/.cursor/skills/my-custom-skill
```

**Example for Windsurf:**
```bash
mkdir -p ~/.windsurf/skills/my-custom-skill
```

Then create `SKILL.md` with YAML front-matter:
```markdown
---
name: my-custom-skill
description: What this skill does
---

# Skill Instructions
[Content here]
```

The skill will automatically appear in `list-skills` output.

### Updating Skills

To update the skills repositories, navigate to your agent's skills directory:

**Example for Cursor:**
```bash
cd ~/.cursor/skills/superpowers && git pull origin main
cd ~/.cursor/skills/anthropic-skills && git pull origin main
```

**Example for Windsurf:**
```bash
cd ~/.windsurf/skills/superpowers && git pull origin main
cd ~/.windsurf/skills/anthropic-skills && git pull origin main
```

Skills update immediately - no agent restart needed.

---

## Resources

- [Superpowers Skills Repo](https://github.com/obra/superpowers/tree/main)
- [Anthropic Skills Repo](https://github.com/anthropics/skills)
- [Node.js Downloads](https://nodejs.org/)
