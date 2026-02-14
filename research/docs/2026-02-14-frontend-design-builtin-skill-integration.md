---
date: 2026-02-14 05:29:22 UTC
researcher: Copilot
git_commit: 060b749d7638485585d3850cdb51444c9b8a8bd0
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "How to add frontend-design as a built-in skill using existing integration methods"
tags: [research, codebase, skills, frontend-design, builtin-skills, skill-commands]
status: complete
last_updated: 2026-02-14
last_updated_by: Copilot
---

# Research: Adding frontend-design as a Built-in Skill

## Research Question

How does the Atomic CLI codebase currently register, discover, and load built-in skills? Document the full skill integration pipeline — from skill definition files (with YAML frontmatter) through registration/discovery mechanisms to runtime invocation — so we can understand the exact pattern to follow when adding `frontend-design` as a new built-in skill.

## Summary

The Atomic CLI has a well-established built-in skill system. Built-in skills are defined as entries in the `BUILTIN_SKILLS` array in `src/ui/commands/skill-commands.ts`. Each entry implements the `BuiltinSkill` interface with `name`, `description`, optional `aliases`, `argumentHint`, `requiredArguments`, and an inline `prompt` string. The prompt body uses `$ARGUMENTS` as a placeholder for user input. Registration happens automatically during `initializeCommands()` → `registerSkillCommands()` → `registerBuiltinSkills()`, which adds each skill to the global command registry as a slash command with `category: "skill"`. At invocation time, `$ARGUMENTS` is expanded and the prompt is sent to the agent via `context.sendSilentMessage()`.

To add `frontend-design` as a built-in skill, one would add a new entry to the `BUILTIN_SKILLS` array following the exact same pattern as the existing 5 skills (`research-codebase`, `create-spec`, `explain-code`, `prompt-engineer`, `testing-anti-patterns`).

## Detailed Findings

### 1. The `BuiltinSkill` Interface

The TypeScript interface at `src/ui/commands/skill-commands.ts:47-60` defines the shape of a built-in skill:

```typescript
export interface BuiltinSkill {
  name: string;              // Command name (without leading slash)
  description: string;       // Human-readable description
  aliases?: string[];        // Alternative command names
  prompt: string;            // Full prompt content (supports $ARGUMENTS placeholder)
  argumentHint?: string;     // Hint text showing expected arguments
  requiredArguments?: string[];  // Required argument names
}
```

### 2. The `BUILTIN_SKILLS` Array

Located at `src/ui/commands/skill-commands.ts:72-1101`, this array contains all embedded skills:

| Skill | Line | Aliases | Required Args |
|-------|------|---------|---------------|
| `research-codebase` | 73 | `research` | `research-question` |
| `create-spec` | 281 | `spec` | `research-path` |
| `explain-code` | 520 | `explain` | `code-path` |
| `prompt-engineer` | 728 | `prompt` | `prompt-description` |
| `testing-anti-patterns` | 905 | `test-patterns` | none |

The array is closed at line 1101. A new entry would be added before the closing `];`.

### 3. Skill Registration Pipeline

The full registration flow:

1. **`src/ui/commands/index.ts:124-134`** — `initializeCommands()` calls `registerSkillCommands()`
2. **`src/ui/commands/skill-commands.ts:1289-1323`** — `registerSkillCommands()` calls `registerBuiltinSkills()` first, then registers legacy disk-based skills
3. **`registerBuiltinSkills()`** iterates over `BUILTIN_SKILLS`, creates a `CommandDefinition` for each via `createBuiltinSkillCommand()`, and registers it with `globalRegistry`
4. **`createBuiltinSkillCommand()`** (line 1228) creates a `CommandDefinition` with `category: "skill"`, validates required arguments, expands `$ARGUMENTS`, and calls `context.sendSilentMessage(expandedPrompt)`

### 4. Argument Expansion

At `src/ui/commands/skill-commands.ts:1144-1145`:

```typescript
function expandArguments(prompt: string, args: string): string {
  return prompt.replace(/\$ARGUMENTS/g, args || "[no arguments provided]");
}
```

### 5. System Prompt Integration

At `src/ui/index.ts:32-72`, `buildCapabilitiesSystemPrompt()` lists all registered skills in the system prompt so the agent knows they exist:

```
Skills (invoke with /skill-name):
  /research-codebase <research-question> - Document codebase as-is...
  /frontend-design - Create distinctive, production-grade frontend interfaces...
```

This happens automatically for any command with `category: "skill"`.

### 6. Legacy `SKILL_DEFINITIONS` Array

At `src/ui/commands/skill-commands.ts:1113-1135`, there is a parallel `SKILL_DEFINITIONS` array with `SkillMetadata` entries (name + description + aliases only, no prompt). This serves as a fallback for disk-based skill loading. Skills that have been moved to `BUILTIN_SKILLS` should NOT be duplicated here unless disk-based override is needed.

### 7. Pinned Skills

At `src/ui/commands/skill-commands.ts:1345-1348`:

```typescript
export const PINNED_BUILTIN_SKILLS = new Set([
  "prompt-engineer",
  "testing-anti-patterns",
]);
```

Pinned skills cannot be overridden by disk-based skills. If `frontend-design` should be non-overridable, it should be added to this set.

### 8. The `frontend-design.md` Source Content

The file at `/home/alilavaee/Documents/projects/atomic/frontend-design.md` already has YAML frontmatter:

```yaml
---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality...
---
```

The body contains detailed instructions about design thinking, typography, color, motion, spatial composition, and anti-patterns for generic AI aesthetics.

### 9. SDK Passthrough (Copilot)

At `src/sdk/copilot-client.ts:732-786`, skill directories are discovered and passed to the Copilot SDK via `skillDirectories` in session config. Built-in skills with embedded prompts do NOT need disk-based `SKILL.md` files for this — they are handled entirely by the Atomic CLI command system.

### 10. Skill UI Indicator

At `src/ui/components/skill-load-indicator.tsx`, the `SkillLoadIndicator` component renders loading/loaded/error states when a skill is invoked. This works automatically for all registered skills.

## Code References

- `src/ui/commands/skill-commands.ts:47-60` — `BuiltinSkill` interface definition
- `src/ui/commands/skill-commands.ts:72-1101` — `BUILTIN_SKILLS` array (add new entry here)
- `src/ui/commands/skill-commands.ts:1113-1135` — `SKILL_DEFINITIONS` legacy array
- `src/ui/commands/skill-commands.ts:1144-1145` — `expandArguments()` function
- `src/ui/commands/skill-commands.ts:1228-1254` — `createBuiltinSkillCommand()` function
- `src/ui/commands/skill-commands.ts:1289-1323` — `registerSkillCommands()` / `registerBuiltinSkills()`
- `src/ui/commands/skill-commands.ts:1345-1348` — `PINNED_BUILTIN_SKILLS` set
- `src/ui/commands/index.ts:124-134` — `initializeCommands()` entry point
- `src/ui/index.ts:32-72` — `buildCapabilitiesSystemPrompt()` system prompt injection
- `src/ui/components/skill-load-indicator.tsx` — Skill load UI component
- `src/utils/markdown.ts:15-116` — `parseMarkdownFrontmatter()` parser
- `src/sdk/copilot-client.ts:732-786` — Copilot SDK skill directory passthrough
- `frontend-design.md` — Source skill content to embed

## Architecture Documentation

### Skill Registration Flow

```
initializeCommands()                       [src/ui/commands/index.ts:124]
  └─ registerSkillCommands()               [skill-commands.ts:1310]
       ├─ registerBuiltinSkills()          [skill-commands.ts:1289]
       │    └─ for each BUILTIN_SKILLS entry:
       │         createBuiltinSkillCommand(skill)  [skill-commands.ts:1228]
       │         globalRegistry.register(command)
       └─ register legacy SKILL_DEFINITIONS [skill-commands.ts:1318]
```

### Skill Invocation Flow

```
User types: /frontend-design "build a landing page"
  └─ Command registry looks up "frontend-design"
       └─ execute(args, context)
            ├─ Validate required arguments (if any)
            ├─ expandArguments(prompt, args)  →  replaces $ARGUMENTS
            └─ context.sendSilentMessage(expandedPrompt)
                 └─ Agent receives expanded skill prompt
```

### Skill Priority System

```
project (3)  >  user (2)  >  builtin (1)
Exception: PINNED_BUILTIN_SKILLS cannot be overridden
```

### Two Types of Skills

| Type | Source | Interface | Prompt Storage |
|------|--------|-----------|----------------|
| Built-in | `BUILTIN_SKILLS` array in TS | `BuiltinSkill` | Embedded inline |
| Disk-based | `SKILL.md` files in discovery dirs | `DiskSkillDefinition` | Loaded from disk |

## Historical Context (from research/)

- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` — Comprehensive research on skill loading from `.opencode`, `.claude`, `.github` configs. Documents the Agent Skills open standard (SKILL.md files with YAML frontmatter), discovery paths, and loading mechanisms across all three SDKs.
- `research/docs/2026-02-02-atomic-builtin-workflows-research.md` — Research on implementing built-in commands, skills, and workflows. Documents making slash-commands built-in and configurable workflows.
- `research/docs/2026-02-05-pluggable-workflows-sdk-design.md` — Design for pluggable SDK that parses commands, sub-agents, and skills from configs.

## Related Research

- `specs/skills.md` — Agent Skills format specification (SKILL.md structure and frontmatter requirements)
- `specs/skill-loading-from-configs-and-ui.md` — Technical design document for skill loading
- `docs/copilot-cli/skills.md` — Copilot CLI skills documentation

## Open Questions

1. Should `frontend-design` be added to `PINNED_BUILTIN_SKILLS` (non-overridable) or allow disk-based overrides?
2. Should `frontend-design` require arguments (e.g., `requiredArguments: ["requirements"]`) or work without them (like `testing-anti-patterns`)?
3. Should an alias be added (e.g., `aliases: ["fd", "design"]`)?
4. Should a corresponding entry be added to the `SKILL_DEFINITIONS` legacy array for disk-based fallback compatibility?
