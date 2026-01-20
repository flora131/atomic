---
date: 2026-01-20 05:08:42 UTC
researcher: Claude Opus 4.5
git_commit: 1ffec185890f3f25ce39164448e9554ee826e27b
branch: main
repository: atomic
topic: "Config Merge Behavior for Init Command - Skip CLAUDE.md/AGENTS.md if Exists"
tags: [research, codebase, init, config, merge, file-preservation, cli]
status: complete
last_updated: 2026-01-20
last_updated_by: Claude Opus 4.5
---

# Research: Config Merge Behavior for Init Command

## Research Question

How to add a feature that merges configurations during `init`:
1. **Skip** CLAUDE.md and AGENTS.md if they already exist in the target directory
2. **Overwrite** other configuration files managed by the CLI
3. **Preserve** files in config directories that aren't managed by the CLI (e.g., don't touch custom workflows in .github/)

## Summary

The current init command uses a complete folder deletion and replacement strategy. To implement the desired merge behavior, modifications are needed at three levels:

1. **Additional files copying** (CLAUDE.md, AGENTS.md, .mcp.json): Add existence check before copying
2. **Config folder copying**: Use file-level merge instead of folder-level replacement
3. **copyDir utility**: Add option to skip files that already exist at destination

The implementation requires changes to:
- `src/commands/init.ts` - Add skip logic for additional files, remove full folder deletion
- `src/utils/copy.ts` - Add `skipIfExists` option to `CopyOptions` and `copyFile`
- `src/config.ts` - Add `preserve_files` array to `AgentConfig` interface for user-customizable files

## Detailed Findings

### Current Init Command Flow

The init command (`src/commands/init.ts:52-201`) follows this flow:

1. **Agent selection** (lines 73-103)
2. **Directory confirmation** (lines 108-121)
3. **Overwrite check** (lines 123-144) - Prompts if folder exists
4. **Folder deletion** (lines 154-157) - **Complete removal if overwriting**
5. **Config folder copy** (lines 159-163) - Full folder copy with exclusions
6. **Additional files copy** (lines 165-173) - Individual file copies

#### Current Folder Deletion Behavior

```typescript
// src/commands/init.ts:154-157
if (folderExists) {
  await rm(targetFolder, { recursive: true, force: true });
}
```

This **deletes the entire folder** before copying, which:
- Removes all user modifications
- Removes any files not in the template
- Prevents stale files from remaining

#### Current Additional Files Copying

```typescript
// src/commands/init.ts:165-173
for (const file of agent.additional_files) {
  const srcFile = join(configRoot, file);
  const destFile = join(targetDir, file);

  if (await pathExists(srcFile)) {
    await copyFile(srcFile, destFile);
  }
}
```

This checks if **source** exists but does **not** check if **destination** exists - always overwrites.

### Agent Configuration Structure

From `src/config.ts:25-60`:

| Agent | folder | exclude | additional_files |
|-------|--------|---------|------------------|
| claude-code | `.claude` | `[".DS_Store"]` | `["CLAUDE.md", ".mcp.json"]` |
| opencode | `.opencode` | `["node_modules", ".gitignore", "bun.lock", "package.json", ".DS_Store"]` | `["AGENTS.md"]` |
| copilot-cli | `.github` | `["workflows", "dependabot.yml", ".DS_Store"]` | `["AGENTS.md"]` |

#### Files That Should Be Preserved

Based on the research question, these files should be **skipped if they exist**:
- `CLAUDE.md` - Project-specific instructions (user-customizable)
- `AGENTS.md` - Project-specific instructions (identical to CLAUDE.md, user-customizable)

These files should still be **overwritten**:
- `.mcp.json` - MCP server configuration (may contain CLI-managed settings)
- All files inside `.claude/`, `.opencode/`, `.github/` folders

### Copy Utilities Analysis

#### CopyOptions Interface (`src/utils/copy.ts:20-25`)

```typescript
interface CopyOptions {
  /** Paths to exclude (relative to source root or base names) */
  exclude?: string[];
  /** Whether to skip scripts for the opposite platform */
  skipOppositeScripts?: boolean;
}
```

Current options support:
- **Exclusion by path/name** - Skip files based on static list
- **Platform-specific filtering** - Skip `.ps1` on Unix, `.sh` on Windows

**Missing capability:** Skip files that already exist at destination.

#### copyFile Function (`src/utils/copy.ts:31-39`)

```typescript
export async function copyFile(src: string, dest: string): Promise<void> {
  try {
    const srcFile = Bun.file(src);
    await Bun.write(dest, srcFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy ${src} to ${dest}: ${message}`);
  }
}
```

This function **always overwrites** - no existence check.

#### copyDir Function (`src/utils/copy.ts:95-164`)

Key processing steps:
1. Creates destination directory (line 106)
2. Reads source entries (line 109)
3. Checks exclusions via `shouldExclude()` (lines 131-134)
4. Checks platform script filtering (lines 136-139)
5. Recursively copies directories, files, and symlinks (lines 141-150)

**No destination existence check** - always copies/overwrites.

### Config Folder Structures

#### .claude/ Structure
```
.claude/
├── settings.json           # CLI-managed
├── agents/                  # CLI-managed (7 files)
├── commands/                # CLI-managed (7 files)
└── skills/                  # CLI-managed (2 directories)
```

#### .opencode/ Structure
```
.opencode/
├── opencode.json            # CLI-managed
├── agent/                   # CLI-managed (7 files)
├── command/                 # CLI-managed (10 files)
├── plugin/                  # CLI-managed
└── skills/                  # CLI-managed
```

#### .github/ Structure (Special Case)
```
.github/
├── agents/                  # CLI-managed
├── prompts/                 # CLI-managed
├── scripts/                 # CLI-managed
├── hooks/                   # CLI-managed
├── skills/                  # CLI-managed
├── workflows/               # EXCLUDED - GitHub CI, not Copilot
└── dependabot.yml           # EXCLUDED - GitHub CI, not Copilot
```

The `.github/` folder already has exclusions for `workflows` and `dependabot.yml` to preserve GitHub CI files.

### Existing Exclusion Patterns

The `shouldExclude()` function (`src/utils/copy.ts:66-84`) supports:

1. **Exact name match**: `exclude.includes(name)`
2. **Path prefix match**: `relativePath === ex || relativePath.startsWith(\`${ex}/\`)`

This only handles **source-side** exclusions (files to not copy), not **destination-side** exclusions (files to not overwrite).

### Test Coverage for File Overwrite

From `tests/copy.test.ts:33-43`:

```typescript
test("overwrites existing file", async () => {
  const srcFile = join(SRC_DIR, "test.txt");
  const destFile = join(DEST_DIR, "test.txt");

  await writeFile(srcFile, "new content");
  await writeFile(destFile, "old content");
  await copyFile(srcFile, destFile);

  const content = await Bun.file(destFile).text();
  expect(content).toBe("new content");
});
```

This confirms the current behavior: `copyFile` **always overwrites**.

## Code References

### Init Command
- `src/commands/init.ts:52-201` - Full `initCommand()` implementation
- `src/commands/init.ts:123-144` - Overwrite confirmation dialog
- `src/commands/init.ts:154-157` - Folder deletion before copy
- `src/commands/init.ts:159-163` - Main folder copy with `copyDir()`
- `src/commands/init.ts:165-173` - Additional files copy loop

### Copy Utilities
- `src/utils/copy.ts:20-25` - `CopyOptions` interface
- `src/utils/copy.ts:31-39` - `copyFile()` function
- `src/utils/copy.ts:66-84` - `shouldExclude()` function
- `src/utils/copy.ts:95-164` - `copyDir()` function
- `src/utils/copy.ts:169-176` - `pathExists()` utility

### Configuration
- `src/config.ts:5-20` - `AgentConfig` interface
- `src/config.ts:25-60` - `AGENT_CONFIG` definitions
- `src/config.ts:33` - CLAUDE.md and .mcp.json as additional files
- `src/config.ts:48,58` - AGENTS.md as additional file

### Tests
- `tests/copy.test.ts:33-43` - File overwrite behavior test
- `tests/init.test.ts:1-209` - Init command unit tests
- `tests/e2e/cli-init-display.test.ts:1-135` - E2E display tests

## Architecture Documentation

### Proposed Changes for Config Merge Behavior

#### 1. Extend CopyOptions Interface

```typescript
// src/utils/copy.ts:20-27 (modified)
interface CopyOptions {
  /** Paths to exclude (relative to source root or base names) */
  exclude?: string[];
  /** Whether to skip scripts for the opposite platform */
  skipOppositeScripts?: boolean;
  /** Skip copying files that already exist at destination */
  skipIfDestExists?: boolean;  // NEW
}
```

#### 2. Modify copyFile to Support Skip-If-Exists

```typescript
// src/utils/copy.ts - new function
export async function copyFileIfNotExists(src: string, dest: string): Promise<boolean> {
  if (await pathExists(dest)) {
    return false; // Skipped
  }
  await copyFile(src, dest);
  return true; // Copied
}
```

#### 3. Modify copyDir to Use Skip-If-Exists Option

In the `copyDir` function, when `skipIfDestExists` is true:
- Check if destination file exists before copying
- Skip files that already exist
- Continue with files that don't exist

#### 4. Extend AgentConfig Interface

```typescript
// src/config.ts:5-20 (modified)
export interface AgentConfig {
  // ... existing fields ...
  /** Files to preserve if they exist (skip during copy) */
  preserve_files?: string[];  // NEW
}
```

#### 5. Modify Init Command Flow

Replace folder deletion with file-level merge:

```typescript
// src/commands/init.ts - modified approach

// REMOVE: Full folder deletion
// if (folderExists) {
//   await rm(targetFolder, { recursive: true, force: true });
// }

// ADD: File-level merge with skipIfDestExists
await copyDir(sourceFolder, targetFolder, {
  exclude: agent.exclude,
  skipOppositeScripts: true,
  skipIfDestExists: false,  // Overwrite managed files
});

// For additional files, check preserve list
for (const file of agent.additional_files) {
  const srcFile = join(configRoot, file);
  const destFile = join(targetDir, file);

  if (await pathExists(srcFile)) {
    const shouldPreserve = agent.preserve_files?.includes(file);
    if (shouldPreserve && await pathExists(destFile)) {
      // Skip - file exists and should be preserved
      continue;
    }
    await copyFile(srcFile, destFile);
  }
}
```

#### 6. Update AGENT_CONFIG with preserve_files

```typescript
// src/config.ts:25-60 (modified)
export const AGENT_CONFIG: Record<AgentKey, AgentConfig> = {
  "claude-code": {
    // ... existing fields ...
    additional_files: ["CLAUDE.md", ".mcp.json"],
    preserve_files: ["CLAUDE.md"],  // NEW: Skip if exists
  },
  opencode: {
    // ... existing fields ...
    additional_files: ["AGENTS.md"],
    preserve_files: ["AGENTS.md"],  // NEW: Skip if exists
  },
  "copilot-cli": {
    // ... existing fields ...
    additional_files: ["AGENTS.md"],
    preserve_files: ["AGENTS.md"],  // NEW: Skip if exists
  },
};
```

### Files to Modify

| File | Change |
|------|--------|
| `src/utils/copy.ts` | Add `skipIfDestExists` to CopyOptions, add `copyFileIfNotExists()` |
| `src/config.ts` | Add `preserve_files` to AgentConfig interface and agent definitions |
| `src/commands/init.ts` | Remove folder deletion, add preserve logic for additional files |
| `tests/copy.test.ts` | Add tests for skip-if-exists behavior |
| `tests/init.test.ts` | Add tests for preserve files behavior |

### Edge Cases to Consider

1. **New files in templates**: New template files added to `.claude/` will still be copied
2. **Removed files in templates**: Old files in user's `.claude/` won't be removed (merge vs overwrite)
3. **Modified template files**: Updates to `.claude/settings.json` won't propagate if user has modifications
4. **Empty folders**: User-created folders inside `.claude/` won't be removed

### Alternative Approach: Keep Full Overwrite for Folder, Only Preserve Additional Files

A simpler approach that still meets the requirements:

1. **Keep current folder behavior** - Full deletion and replacement for `.claude/`, `.opencode/`, `.github/`
2. **Only modify additional files logic** - Check existence for CLAUDE.md and AGENTS.md

This is simpler because:
- Config folder contents are fully CLI-managed
- Only CLAUDE.md/AGENTS.md are user-customizable
- .mcp.json can still be overwritten (contains CLI settings)

```typescript
// src/commands/init.ts - simpler approach for additional files only
const PRESERVE_IF_EXISTS = ["CLAUDE.md", "AGENTS.md"];

for (const file of agent.additional_files) {
  const srcFile = join(configRoot, file);
  const destFile = join(targetDir, file);

  if (await pathExists(srcFile)) {
    if (PRESERVE_IF_EXISTS.includes(file) && await pathExists(destFile)) {
      // Skip - preserve user's CLAUDE.md or AGENTS.md
      log.info(`Skipping ${file} (already exists)`);
      continue;
    }
    await copyFile(srcFile, destFile);
  }
}
```

## Historical Context (from research/)

- `research/docs/2026-01-19-cli-auto-init-agent.md` - Related research on auto-init behavior
- `research/docs/2026-01-18-atomic-cli-implementation.md` - Original CLI implementation research
- `specs/cli-auto-init-agent.md` - Spec for auto-init feature, includes "Non-Goals" section stating:
  - "We will NOT add config merging or updating (still overwrite-only)"

The current "overwrite-only" approach was an intentional design decision documented in the spec.

## Related Research

- [research/docs/2026-01-19-cli-auto-init-agent.md](./2026-01-19-cli-auto-init-agent.md) - Auto-init behavior when running `atomic --agent`
- [research/docs/2026-01-18-atomic-cli-implementation.md](./2026-01-18-atomic-cli-implementation.md) - Original CLI implementation details

## Open Questions

1. **Should .mcp.json be preserved?** Currently proposed to overwrite since it may contain CLI-managed MCP settings. User might have custom MCP servers configured.

2. **User feedback on skip?** Should the CLI inform users when files are skipped? e.g., "Skipping CLAUDE.md (already exists)"

3. **Force overwrite flag?** Should there be a `--force` flag to overwrite even preserved files?

4. **What about folder contents?** The simpler approach preserves only CLAUDE.md/AGENTS.md. Should any files inside `.claude/` also be preserved?

5. **Migration path?** How should existing users be informed of this behavior change?
