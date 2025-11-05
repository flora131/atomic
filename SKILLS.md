# Skills Reference

This document contains the shared skills protocol and guidelines used across all agent instruction files.

## Mandatory First Response Protocol

Before responding to ANY user message, you MUST complete this checklist:

1. ☐ List available skills in your mind
2. ☐ Ask yourself: "Does ANY skill match this request?"
3. ☐ If yes → Use the Skill tool to read and run the skill file
4. ☐ Announce which skill you're using
5. ☐ Follow the skill exactly

**Responding WITHOUT completing this checklist = automatic failure.**

## Common Rationalizations That Mean You're About To Fail

If you catch yourself thinking ANY of these thoughts, STOP. You are rationalizing. Check for and use the skill.

- "This is just a simple question" → WRONG. Questions are tasks. Check for skills.
- "I can check git/files quickly" → WRONG. Files don't have conversation context. Check for skills.
- "Let me gather information first" → WRONG. Skills tell you HOW to gather information. Check for skills.
- "This doesn't need a formal skill" → WRONG. If a skill exists for it, use it.
- "I remember this skill" → WRONG. Skills evolve. Run the current version.
- "This doesn't count as a task" → WRONG. If you're taking action, it's a task. Check for skills.
- "The skill is overkill for this" → WRONG. Skills exist because simple things become complex. Use it.
- "I'll just do this one thing first" → WRONG. Check for skills BEFORE doing anything.

**Why:** Skills document proven techniques that save time and prevent mistakes. Not using available skills means repeating solved problems and making known errors.

If a skill for your task exists, you must use it or you will fail at your task.

## How to Use Skills

You have skills available.

**Note:** Claude Code has native skills support - no additional setup needed for Claude Code users!

For other agents, skills must be installed first. See [SKILLS_SETUP.md](SKILLS_SETUP.md) for installation instructions.

### Listing Available Skills

- List your skills by running the list-skills command with your agent's skills directory:
  - **Codex**: `list-skills ~/.codex/skills`
  - **Cursor**: `list-skills ~/.cursor/skills`
  - **Windsurf**: `list-skills ~/.windsurf/skills`
  - **GitHub Copilot**: `list-skills ~/.github/skills`
- Remember the skill names and descriptions
- If a skill matches a task, read its full SKILL.md and use it
- Announce: "I've read the [Skill Name] skill and I'm using it to [purpose]"

### Skills with Checklists

If a skill has a checklist, you MUST create TodoWrite todos for EACH item.

**Don't:**
- Work through checklist mentally
- Skip creating todos "to save time"
- Batch multiple items into one todo
- Mark complete without doing them

**Why:** Checklists without TodoWrite tracking = steps get skipped. Every time. The overhead of TodoWrite is tiny compared to the cost of missing steps.

## Key Principles

1. **Finding a relevant skill = mandatory to read and use it.** Not optional.
2. **Skills document proven techniques** that save time and prevent mistakes.
3. **Always announce** which skill you're using and why.
4. **Follow skills exactly** - don't rationalize away the discipline.
5. **Create TodoWrite todos** for any skill checklists.

---

For setup instructions, see [SKILLS_SETUP.md](SKILLS_SETUP.md).
