# Guidelines for Development

# MANDATORY FIRST RESPONSE PROTOCOL

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

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `specs/PLANS.md`) from design to implementation. If the user request requires multiple specs, create multiple specification files in the `specs/` directory. After creating the specs, create a master ExecPlan that links to each individual spec ExecPlan. Update the `specs/README.md` to include links to the new specs.

ALWAYS start an ExecPlan creation by consulting the DeepWiki tool for best practices on design patterns, architecture, and implementation strategies. Ask it questions about the system design and constructs in the library that will help you achieve your goals.

Skip using an ExecPlan for straightforward tasks (roughly the easiest 25%).

## Smart Scope Selection

Based off of the user request you need to determine the appropriate scope of the system for the spec.

1. **Frontend Only**: If the request only involves user interface changes, visual elements, or client-side logic, target the frontend component.
2. **Backend Only**: If the request involves data processing, business logic, database interactions, or server-side functionality, target the backend component.
3. **Both Frontend and Backend**: If the request involves changes that affect both the user interface and server-side logic, you will need to make coordinated changes in both the frontend and backend components.

## Skills
You have skills available.
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST read the skill.
IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.
This is not negotiable. This is not optional. You cannot rationalize your way out of this.
- List your skills by running the list-skills command with your agent's skills directory:
  - Codex: `list-skills ~/.codex/skills`
  - Cursor: `list-skills ~/.cursor/skills`
  - Windsurf: `list-skills ~/.windsurf/skills`
  - GitHub Copilot: `list-skills ~/.github/skills`
- Remember the skill names and descriptions
- If a skill matches a task, read its full SKILL.md and use it
- Announce: "I've read the [Skill Name] skill and I'm using it to [purpose]"
