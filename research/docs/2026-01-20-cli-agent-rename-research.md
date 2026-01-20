---
date: 2026-01-20 06:39:16 UTC
researcher: Claude Opus 4.5
git_commit: 05dc5dc4fbb071e5ca601e57ae2adafa93b69db0
branch: lavaman131/feature/cli-agent-rename
repository: atomic
topic: "CLI Agent Rename: claude-code → claude, copilot-cli → copilot"
tags: [research, cli, agent-rename, refactoring, breaking-change]
status: complete
last_updated: 2026-01-20
last_updated_by: Claude Opus 4.5
---

# Research: CLI Agent Rename

## Research Question

Document all code locations, tests, and documentation that reference the CLI agent names `claude-code` and `copilot-cli`, which need to be modified to `claude` and `copilot` respectively. Include command-line argument parsing, agent registration, configuration files, test files, and README documentation.

## Summary

This renaming task involves modifying the agent key identifiers used throughout the Atomic CLI codebase. The changes are:
- `claude-code` → `claude`
- `copilot-cli` → `copilot`

The core change location is `src/config.ts:26` where `AGENT_KEYS` is defined. All other references derive from or relate to this definition. The change affects:

| Category | Files Affected | Total References |
|----------|----------------|------------------|
| Source code (src/) | 4 files | ~25 references |
| Test files (tests/) | 8 files | ~100+ references |
| Documentation (README.md) | 1 file | ~20 references |
| Specifications (specs/) | 5 files | ~50+ references |
| Research docs (research/) | 6 files | ~40+ references |
| Shell scripts (.github/) | 4 files | ~10 references |

**TOTAL: ~250+ references across ~28 files**

---

## Detailed Findings

### 1. Primary Definition - MUST CHANGE FIRST

#### `/home/alilavaee/Documents/projects/atomic/src/config.ts`

This is the **source of truth** for agent keys. Change here affects the entire codebase.

| Line | Current Code | Required Change |
|------|--------------|-----------------|
| 26 | `const AGENT_KEYS = ["claude-code", "opencode", "copilot-cli"] as const;` | `const AGENT_KEYS = ["claude", "opencode", "copilot"] as const;` |
| 30 | `"claude-code": {` | `"claude": {` |
| 58 | `"copilot-cli": {` | `"copilot": {` |

**Full context (lines 26-70):**
```typescript
const AGENT_KEYS = ["claude-code", "opencode", "copilot-cli"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  "claude-code": {  // ← Change to "claude"
    name: "Claude Code",
    cmd: "claude",
    // ...
  },
  opencode: {
    // ... (no change needed)
  },
  "copilot-cli": {  // ← Change to "copilot"
    name: "GitHub Copilot CLI",
    cmd: "copilot",
    // ...
  },
};
```

---

### 2. Source Code Files (src/)

#### `/home/alilavaee/Documents/projects/atomic/src/index.ts`

Help text examples need updating:

| Line | Current | New |
|------|---------|-----|
| 58 | `atomic init -a claude-code` | `atomic init -a claude` |
| 59 | `atomic -a claude-code` | `atomic -a claude` |
| 60 | `atomic -a claude-code -- "fix the bug"` | `atomic -a claude -- "fix the bug"` |
| 62 | `atomic -a claude-code -- --help` | `atomic -a claude -- --help` |

#### `/home/alilavaee/Documents/projects/atomic/src/commands/run-agent.ts`

JSDoc examples need updating:

| Line | Current | New |
|------|---------|-----|
| 31 | `@param agentKey The agent key (e.g., "claude-code", "opencode", "copilot-cli")` | `@param agentKey The agent key (e.g., "claude", "opencode", "copilot")` |
| 37 | `await runAgentCommand("claude-code");` | `await runAgentCommand("claude");` |
| 41 | `await runAgentCommand("claude-code", ["fix the bug in auth"]);` | `await runAgentCommand("claude", ["fix the bug in auth"]);` |
| 49 | `await runAgentCommand("claude-code", ["--help"]);` | `await runAgentCommand("claude", ["--help"]);` |

#### `/home/alilavaee/Documents/projects/atomic/src/utils/arg-parser.ts`

JSDoc examples need updating (14 references):

| Line | Current | New |
|------|---------|-----|
| 14 | `isAgentRunMode(["-a", "claude-code"])` | `isAgentRunMode(["-a", "claude"])` |
| 16 | `isAgentRunMode(["init", "-a", "claude-code"])` | `isAgentRunMode(["init", "-a", "claude"])` |
| 40 | `extractAgentName(["-a", "claude-code"])` | `extractAgentName(["-a", "claude"])` |
| 81 | `hasForceFlag(["-a", "claude-code", "-f"])` | `hasForceFlag(["-a", "claude", "-f"])` |
| 83 | `hasForceFlag(["-a", "claude-code", "--", "-f"])` | `hasForceFlag(["-a", "claude", "--", "-f"])` |
| 84 | `hasForceFlag(["-a", "claude-code"])` | `hasForceFlag(["-a", "claude"])` |
| 106 | `extractAgentArgs(["-a", "claude-code", "--", "/commit"])` | `extractAgentArgs(["-a", "claude", "--", "/commit"])` |
| 110 | `extractAgentArgs(["-a", "claude-code", "--", "--help"])` | `extractAgentArgs(["-a", "claude", "--", "--help"])` |
| 114 | `extractAgentArgs(["-a", "claude-code"])` | `extractAgentArgs(["-a", "claude"])` |
| 135 | `isInitWithSeparator(["init", "-a", "claude-code", "--", "/commit"])` | `isInitWithSeparator(["init", "-a", "claude", "--", "/commit"])` |
| 139 | `isInitWithSeparator(["init", "-a", "claude-code"])` | `isInitWithSeparator(["init", "-a", "claude"])` |
| 143 | `isInitWithSeparator(["-a", "claude-code", "--", "/commit"])` | `isInitWithSeparator(["-a", "claude", "--", "/commit"])` |
| 167 | `detectMissingSeparatorArgs(["-a", "claude-code", "/commit"])` | `detectMissingSeparatorArgs(["-a", "claude", "/commit"])` |
| 171 | `detectMissingSeparatorArgs(["-a", "claude-code", "fix the bug"])` | `detectMissingSeparatorArgs(["-a", "claude", "fix the bug"])` |
| 175 | `detectMissingSeparatorArgs(["-a", "claude-code", "--", "/commit"])` | `detectMissingSeparatorArgs(["-a", "claude", "--", "/commit"])` |

---

### 3. Test Files (tests/)

All test files need updating. Here is the comprehensive list:

#### `/home/alilavaee/Documents/projects/atomic/tests/routing.test.ts`

**Extensive changes required** - This file has the most references (~60+).

Key patterns to find/replace:
- `"claude-code"` → `"claude"` (all occurrences)
- `"copilot-cli"` → `"copilot"` (all occurrences)

Notable test cases requiring updates:
- Lines 34-53: Tests for parsing `init --agent claude-code`
- Lines 67-75: Test for `init -a copilot-cli`
- Lines 93-104: Agent run mode tests
- Lines 203-327: `isAgentRunMode`, `extractAgentName`, `extractAgentArgs` tests
- Lines 370-432: `detectMissingSeparatorArgs` tests
- Lines 451-518: `hasForceFlag` and `isInitWithSeparator` tests

#### `/home/alilavaee/Documents/projects/atomic/tests/init.test.ts`

| Lines | Context |
|-------|---------|
| 43-57 | `isValidAgent("claude-code")` tests and case sensitivity |
| 75-102 | Type definitions and agent selection tests |
| 113-122 | Force flag tests with `claude-code` |
| 134-158 | Config retrieval tests for all agents |
| 174-208 | Agent selection flow tests |

Type definitions on multiple lines:
```typescript
type AgentKey = "claude-code" | "opencode" | "copilot-cli";
// Change to:
type AgentKey = "claude" | "opencode" | "copilot";
```

#### `/home/alilavaee/Documents/projects/atomic/tests/cli.test.ts`

| Line | Current | New |
|------|---------|-----|
| 34 | `expect(keys).toContain("claude-code");` | `expect(keys).toContain("claude");` |
| 36 | `expect(keys).toContain("copilot-cli");` | `expect(keys).toContain("copilot");` |

#### `/home/alilavaee/Documents/projects/atomic/tests/run-agent.test.ts`

| Lines | Context |
|-------|---------|
| 39, 47 | Invalid case test `"Claude-Code"` and output validation |
| 63-85 | Folder path tests for all agents |
| 103-133 | Auto-init tests with `claude-code` |
| 192 | Valid keys array definition |

Special case-sensitivity test (line 39):
```typescript
const exitCode = await runAgentCommand("Claude-Code");
// Change to:
const exitCode = await runAgentCommand("Claude");
```

#### `/home/alilavaee/Documents/projects/atomic/tests/config.test.ts`

| Lines | Context |
|-------|---------|
| 76-77 | claude-code preserves CLAUDE.md test |
| 89-93 | copilot-cli preserves AGENTS.md test |
| 98-106 | `isValidAgent` tests |
| 112-123 | `getAgentConfig` and `getAgentKeys` tests |

#### `/home/alilavaee/Documents/projects/atomic/tests/display-order.test.ts`

References on lines: 64, 91, 133, 154, 187, 211, 229, 252, 270, 293, 322, 345

All use `"claude-code"` for display order tests.

#### `/home/alilavaee/Documents/projects/atomic/tests/e2e/cli-init-display.test.ts`

| Lines | Context |
|-------|---------|
| 75-77 | E2E test for `atomic -a claude-code` without config |
| 95-97 | E2E test for `atomic init -a claude-code` |
| 116-121 | E2E test for `atomic -a claude-code` with existing config |

---

### 4. README.md Documentation

#### `/home/alilavaee/Documents/projects/atomic/README.md`

| Line | Current | New |
|------|---------|-----|
| 118 | `atomic --agent claude-code -- /research-codebase` | `atomic --agent claude -- /research-codebase` |
| 128 | `atomic --agent claude-code -- /create-spec` | `atomic --agent claude -- /create-spec` |
| 138 | `atomic --agent claude-code -- /create-feature-list` | `atomic --agent claude -- /create-feature-list` |
| 154 | `atomic --agent claude-code -- /implement-feature` | `atomic --agent claude -- /implement-feature` |
| 171 | `atomic --agent claude-code -- /ralph:ralph-loop` | `atomic --agent claude -- /ralph:ralph-loop` |
| 183 | `atomic --agent claude-code -- "Use the debugging agent..."` | `atomic --agent claude -- "Use the debugging agent..."` |
| 189 | `atomic --agent claude-code -- "Follow the debugging report..."` | `atomic --agent claude -- "Follow the debugging report..."` |
| 195 | `atomic --agent claude-code -- /create-gh-pr` | `atomic --agent claude -- /create-gh-pr` |
| 248 | `\| Claude Code \| \`atomic --agent claude-code\`` | `\| Claude Code \| \`atomic --agent claude\`` |
| 250 | `\| GitHub Copilot CLI \| \`atomic --agent copilot-cli\`` | `\| GitHub Copilot CLI \| \`atomic --agent copilot\`` |
| 253-254 | Example usage with `claude-code` | Update to `claude` |

**Supported Coding Agents table (line 246-251):**
```markdown
| Agent              | CLI Command                  | Folder       | Context File |
| ------------------ | ---------------------------- | ------------ | ------------ |
| Claude Code        | `atomic --agent claude`      | `.claude/`   | `CLAUDE.md`  |
| OpenCode           | `atomic --agent opencode`    | `.opencode/` | `AGENTS.md`  |
| GitHub Copilot CLI | `atomic --agent copilot`     | `.github/`   | `AGENTS.md`  |
```

---

### 5. Shell Scripts (.github/)

These files contain comments referencing `copilot-cli`:

#### `/home/alilavaee/Documents/projects/atomic/.github/hooks/stop-hook.sh`
- Line 8: Comment `# it spawns a new detached copilot-cli session`
- Line 163: Comment `# Spawn new copilot-cli session in background`

#### `/home/alilavaee/Documents/projects/atomic/.github/hooks/stop-hook.ps1`
- Line 5: Comment about `copilot-cli`
- Line 165, 172: Comments about piping to `copilot-cli`

#### `/home/alilavaee/Documents/projects/atomic/.github/scripts/cancel-ralph.sh`
- Lines 19, 42, 43: References to `copilot-cli` processes

#### `/home/alilavaee/Documents/projects/atomic/.github/prompts/cancel-ralph.prompt.md`
- Line 20: Documentation item about killing `copilot-cli` processes

---

### 6. Specification Documents (specs/)

These are historical specs that document the original design. They should be updated for consistency but are lower priority:

| File | Reference Count |
|------|-----------------|
| `specs/readme-update-spec.md` | ~20 references |
| `specs/atomic-cli-implementation.md` | ~10 references |
| `specs/cli-auto-init-agent.md` | ~25 references |
| `specs/cli-banner-ordering-fix.md` | ~8 references |
| `specs/init-config-merge-behavior.md` | ~30 references |

---

### 7. Research Documents (research/)

Historical research documents that should be updated for consistency:

| File | Reference Count |
|------|-----------------|
| `research/docs/2026-01-20-init-config-merge-behavior.md` | ~5 references |
| `research/docs/2026-01-19-cli-auto-init-agent.md` | ~6 references |
| `research/docs/2026-01-18-atomic-cli-implementation.md` | ~10 references |
| `research/docs/2026-01-19-cli-ordering-fix.md` | ~3 references |
| `research/docs/2026-01-19-readme-update-research.md` | ~20 references |
| `research/feature-list.json` | ~3 references |

---

### 8. Files That Do NOT Need Changes

The following files contain `claude-code` but are **external references** (GitHub Actions) that should NOT be changed:

- `.github/workflows/pr-description.yml` - Line 22: `uses: anthropics/claude-code-action@v1`
- `.github/workflows/ci.yml` - Line 80: `uses: anthropics/claude-code-action@v1`

These reference the Anthropic GitHub Action, not our CLI agent key.

---

## Code References

### Primary Files (Must Change)
- `src/config.ts:26` - AGENT_KEYS definition (source of truth)
- `src/config.ts:30` - "claude-code" config object key
- `src/config.ts:58` - "copilot-cli" config object key

### Secondary Files (Source Code)
- `src/index.ts:58-62` - Help text examples
- `src/commands/run-agent.ts:31-49` - JSDoc examples
- `src/utils/arg-parser.ts:14-175` - JSDoc examples (14 locations)

### Test Files
- `tests/routing.test.ts` - ~60+ references
- `tests/init.test.ts` - ~20 references
- `tests/cli.test.ts` - 3 references
- `tests/run-agent.test.ts` - ~15 references
- `tests/config.test.ts` - ~10 references
- `tests/display-order.test.ts` - ~12 references
- `tests/e2e/cli-init-display.test.ts` - ~6 references

### Documentation
- `README.md` - ~20 references

---

## Architecture Documentation

### Type System Impact

The `AgentKey` type is derived from `AGENT_KEYS`:
```typescript
const AGENT_KEYS = ["claude-code", "opencode", "copilot-cli"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];
// Currently: "claude-code" | "opencode" | "copilot-cli"
// After change: "claude" | "opencode" | "copilot"
```

### Validation Flow

1. User provides agent name via `--agent` flag
2. `extractAgentName()` extracts the string value
3. `isValidAgent()` checks if key exists in `AGENT_CONFIG`
4. `getAgentConfig()` retrieves the configuration object

All validation uses `key in AGENT_CONFIG`, so changing the keys automatically updates validation.

---

## Historical Context

This research is part of a feature branch `lavaman131/feature/cli-agent-rename` to simplify the CLI agent names:
- `claude-code` → `claude` (matches the underlying command `claude`)
- `copilot-cli` → `copilot` (matches the underlying command `copilot`)

The `opencode` agent key already matches its command name and requires no change.

---

## Related Research

- `research/docs/2026-01-18-atomic-cli-implementation.md` - Original CLI implementation research
- `research/docs/2026-01-19-readme-update-research.md` - README documentation research

---

## Implementation Checklist

### Phase 1: Core Changes (Breaking)
- [ ] Update `src/config.ts:26` - Change AGENT_KEYS array
- [ ] Update `src/config.ts:30` - Change "claude-code" object key to "claude"
- [ ] Update `src/config.ts:58` - Change "copilot-cli" object key to "copilot"

### Phase 2: Source Code Updates
- [ ] Update `src/index.ts` - Help text examples (4 lines)
- [ ] Update `src/commands/run-agent.ts` - JSDoc examples (4 lines)
- [ ] Update `src/utils/arg-parser.ts` - JSDoc examples (14 lines)

### Phase 3: Test Updates
- [ ] Update `tests/routing.test.ts` - All agent references
- [ ] Update `tests/init.test.ts` - All agent references + type definitions
- [ ] Update `tests/cli.test.ts` - Agent key assertions
- [ ] Update `tests/run-agent.test.ts` - Agent references + case sensitivity test
- [ ] Update `tests/config.test.ts` - Agent key tests
- [ ] Update `tests/display-order.test.ts` - Agent references
- [ ] Update `tests/e2e/cli-init-display.test.ts` - E2E test agent names

### Phase 4: Documentation Updates
- [ ] Update `README.md` - All CLI examples and agent table

### Phase 5: Optional Updates (Lower Priority)
- [ ] Update shell scripts in `.github/` - Comments only
- [ ] Update specification documents in `specs/`
- [ ] Update research documents in `research/docs/`

---

## Open Questions

1. **Backward Compatibility**: Should aliases be added for the old names (`claude-code` → `claude`, `copilot-cli` → `copilot`) to maintain backward compatibility?

2. **Migration Period**: Should there be a deprecation warning when using old names before fully removing support?

3. **Spec/Research Documents**: Should historical spec and research documents be updated, or left as historical record with a note about the rename?
