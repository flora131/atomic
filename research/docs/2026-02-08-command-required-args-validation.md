---
date: 2026-02-08 02:54:57 UTC
researcher: Claude Opus 4.6
git_commit: 7ea342b68fd3e84c1089b33593ec1be5b123656d
branch: lavaman131/feature/tui
repository: atomic
topic: "How to add required argument validation to TUI skill commands (like /ralph does)"
tags: [research, codebase, commands, validation, skill-commands, error-handling]
status: complete
last_updated: 2026-02-08
last_updated_by: Claude Opus 4.6
---

# Research

## Research Question

How does the `/ralph` command in the atomic TUI validate required parameters and return error messages, and how can the same pattern be applied to built-in skill commands (like `/research-codebase`) so they return errors when required arguments are missing instead of silently proceeding?

## Summary

The `/ralph` command validates required parameters inside its `execute` function by checking parsed arguments and returning `{ success: false, message: "..." }` when validation fails. This pattern is straightforward to apply to skill commands. The key change is adding argument validation in either `createBuiltinSkillCommand()` or `createSkillCommand()` factory functions before sending the prompt to the session. A new optional field (e.g., `requiresArguments: boolean`) on `BuiltinSkill` would allow per-skill opt-in to argument enforcement.

## Detailed Findings

### 1. The Ralph Validation Pattern

The `/ralph` command is created by `createRalphCommand()` in `src/ui/commands/workflow-commands.ts:780-930`. Its `execute` function validates arguments before proceeding, returning early with `{ success: false, message: "..." }` when required parameters are missing.

Key validation points inside `createRalphCommand()`:

| Lines | Condition | Error Message |
|-------|-----------|---------------|
| 802-806 | `--resume` without UUID value | `"Missing session ID..."` |
| 810-814 | `--resume` with invalid UUID | `"Invalid session ID format..."` |
| 819-823 | `--resume` with non-existent session | `"Session not found: {id}"` |
| 857-861 | `--yolo` without prompt | `"--yolo flag requires a prompt..."` |
| 865-869 | No flags and no prompt at all | `"Please provide a prompt for the ralph workflow.\nUsage: /ralph <your task description>..."` |
| 873-877 | Non-yolo mode with missing feature list file | `"Feature list file not found: {path}..."` |

The pattern is:
```typescript
execute: (args: string, context: CommandContext): CommandResult => {
  // Parse/validate args
  if (!valid) {
    return {
      success: false,
      message: `Error description.\nUsage: /command <expected-args>`,
    };
  }
  // Proceed with normal execution
  return { success: true, ... };
}
```

### 2. Current Skill Command Behavior (No Validation)

Skill commands are created by two factory functions in `src/ui/commands/skill-commands.ts`:

**`createBuiltinSkillCommand()` (lines 1624-1642):**
```typescript
execute: (args: string, context: CommandContext): CommandResult => {
  const skillArgs = args.trim();
  // No validation -- directly expands prompt and sends it
  const expandedPrompt = expandArguments(skill.prompt, skillArgs);
  context.sendSilentMessage(expandedPrompt);
  return { success: true };
}
```

**`createSkillCommand()` (lines 1577-1612):**
```typescript
execute: (args: string, context: CommandContext): CommandResult => {
  const skillArgs = args.trim();
  // Check for builtin skill with embedded prompt
  const builtinSkill = getBuiltinSkill(metadata.name);
  if (builtinSkill) {
    const expandedPrompt = expandArguments(builtinSkill.prompt, skillArgs);
    context.sendSilentMessage(expandedPrompt);
    return { success: true };
  }
  // Fallback: send slash command
  // ...
  return { success: true };
}
```

Both factories **always return `{ success: true }`** -- they never validate arguments.

The `expandArguments()` function (`src/ui/commands/skill-commands.ts:1548-1550`) substitutes `$ARGUMENTS` with the user's args, falling back to `"[no arguments provided]"`:
```typescript
function expandArguments(prompt: string, args: string): string {
  return prompt.replace(/\$ARGUMENTS/g, args || "[no arguments provided]");
}
```

So when a user types `/research-codebase` with no argument, the expanded prompt contains the literal string `[no arguments provided]` where `$ARGUMENTS` was. The command still sends the prompt and returns success.

### 3. How Command Results Are Displayed

In `src/ui/chat.tsx` (the `executeCommand` function around line 1692):

- When `result.message` is present, it is displayed as an `"assistant"` role message (line 1945), regardless of `result.success`.
- The `result.success` boolean is used only as the return value of `executeCommand()`.
- "Command not found" uses `"system"` role (red-colored text).
- There is **no visual distinction** between `success: true` messages and `success: false` messages -- both render as standard assistant messages.

This means returning `{ success: false, message: "Please provide a research question..." }` will display the error message in the chat as an assistant message, which is the same behavior as `/ralph` error messages.

### 4. The `BuiltinSkill` Interface

Defined at `src/ui/commands/skill-commands.ts:45-58`:
```typescript
export interface BuiltinSkill {
  name: string;
  description: string;
  aliases?: string[];
  prompt: string;
  hidden?: boolean;
  argumentHint?: string;
}
```

There is no `requiresArguments` field. Adding one would allow per-skill opt-in.

### 5. Skills That Should Require Arguments

Based on the `BUILTIN_SKILLS` array (`src/ui/commands/skill-commands.ts:70-1485`), the following skills use `$ARGUMENTS` meaningfully and would benefit from required argument validation:

| Skill | `argumentHint` | Should Require Args? |
|-------|---------------|---------------------|
| `commit` | `[message] \| --amend` | No -- works without args (auto-detects changes) |
| `research-codebase` | `[research-question]` | **Yes** -- research question is central to the prompt |
| `create-spec` | `[research-path]` | **Yes** -- needs a research path to read from |
| `create-feature-list` | `[spec-path]` | **Yes** -- needs a spec path to parse |
| `implement-feature` | (none) | No -- reads from feature-list.json automatically |
| `create-gh-pr` | (none) | No -- auto-detects changes |
| `explain-code` | `[code-path]` | **Yes** -- needs a code path or reference |
| `prompt-engineer` | `[prompt-description]` | **Yes** -- needs a description of what to create |
| `testing-anti-patterns` | (hidden) | No -- hidden utility skill |

### 6. Agent Commands (Also No Validation)

Agent commands in `src/ui/commands/agent-commands.ts:1622-1648` follow the same pass-through pattern. The `createAgentCommand()` factory never validates arguments -- when called without args, it sends just the agent's system prompt with no user request section. This is a separate concern but follows the same pattern.

### 7. The `CommandDefinition` Interface

Defined at `src/ui/commands/registry.ts:167-182`:
```typescript
export interface CommandDefinition {
  name: string;
  description: string;
  category: CommandCategory;
  execute: (args: string, context: CommandContext) => CommandResult | Promise<CommandResult>;
  aliases?: string[];
  hidden?: boolean;
  argumentHint?: string;
}
```

There is no `requiresArguments` field on `CommandDefinition` either. Validation is done entirely inside `execute()` implementations.

## Code References

- `src/ui/commands/workflow-commands.ts:780-930` - `createRalphCommand()` with full argument validation pattern
- `src/ui/commands/workflow-commands.ts:865-869` - Ralph's "no prompt provided" error (the pattern to replicate)
- `src/ui/commands/skill-commands.ts:45-58` - `BuiltinSkill` interface (needs `requiresArguments` field)
- `src/ui/commands/skill-commands.ts:70-1485` - `BUILTIN_SKILLS` array (skills to add `requiresArguments: true`)
- `src/ui/commands/skill-commands.ts:1548-1550` - `expandArguments()` function
- `src/ui/commands/skill-commands.ts:1624-1642` - `createBuiltinSkillCommand()` factory (where validation should be added)
- `src/ui/commands/skill-commands.ts:1577-1612` - `createSkillCommand()` factory (alternative validation site)
- `src/ui/commands/registry.ts:138-157` - `CommandResult` interface
- `src/ui/commands/registry.ts:167-182` - `CommandDefinition` interface
- `src/ui/commands/agent-commands.ts:1622-1648` - `createAgentCommand()` factory (same issue)
- `src/ui/chat.tsx:1692` - `executeCommand()` function
- `src/ui/chat.tsx:1944-1947` - How `result.message` is displayed

## Architecture Documentation

### Command System Architecture

The command system follows a layered design:

1. **Definition layer** - `CommandDefinition` interface in `registry.ts`
2. **Factory layer** - Category-specific factories: `createBuiltinSkillCommand()`, `createSkillCommand()`, `createWorkflowCommand()`, `createRalphCommand()`, `createAgentCommand()`
3. **Registration layer** - `register*Commands()` functions feed into `globalRegistry` singleton
4. **Parsing layer** - `parseSlashCommand()` in `index.ts` extracts command name and args
5. **Execution layer** - `executeCommand()` in `chat.tsx` dispatches to the command's `execute()` function
6. **Display layer** - `result.message` rendered as assistant message; `result.success` returned as boolean

### Validation Pattern Convention

The codebase follows a convention where argument validation is done inside the `execute()` function body, not at the framework level. The `/ralph` command is the canonical example. The `CommandDefinition` and `CommandResult` interfaces already support this pattern -- no framework changes are needed.

## Historical Context (from research/)

- `research/docs/2026-01-19-slash-commands.md` - Comprehensive catalog of all slash commands across platforms; documents the `$ARGUMENTS` placeholder pattern
- `research/docs/2026-02-03-command-migration-notes.md` - Notes on command migration; relevant to command registration architecture
- `research/docs/2026-01-25-commander-js-migration.md` - Commander.js migration research; Commander.js supports required arguments natively

## Related Research

- `research/docs/2026-01-19-slash-commands.md` - Slash command catalog
- `research/docs/2026-02-03-command-migration-notes.md` - Command migration notes

## Open Questions

1. Should the error message use `"system"` role (red text) instead of `"assistant"` role for visual distinction? Currently `/ralph` errors display as normal assistant messages.
2. Should `argumentHint` brackets convention be formalized? Currently `[arg]` suggests optional while no brackets could suggest required, but this is not enforced.
3. Should agent commands also get required argument validation, or is sending the agent prompt without a user request acceptable?
