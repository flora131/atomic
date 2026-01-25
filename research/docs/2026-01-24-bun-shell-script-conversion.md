---
date: 2026-01-24 19:16:10 PST
researcher: Claude Code
git_commit: 86faf7d39ac9ce5e303ea561139f2c5575a186ad
branch: flora131/feature/add-anon-telem
repository: atomic
topic: "Bun TypeScript Conversion of Shell Scripts in .github/scripts"
tags: [research, bun, typescript, shell-scripts, conversion, ralph-loop]
status: complete
last_updated: 2026-01-24
last_updated_by: Claude Code
---

# Research: Converting .github/scripts Shell Scripts to Bun TypeScript

## Research Question

How to modify all implementations in `.github/scripts/` to use Bun instead (repo: `oven-sh/bun`). It should be a 1:1 conversion from the shell scripts. Also, modify the naming conventions to model the naming conventions in `.opencode` and `.claude`, e.g., `ralph-loop.local.md`, etc.

## Summary

This research documents a complete conversion guide for transforming 4 bash shell scripts in `.github/scripts/` to Bun TypeScript. The conversion leverages Bun's native APIs (`Bun.$`, `Bun.file()`, `Bun.write()`, `Bun.stdin`, `Bun.spawn()`) to provide 1:1 functional equivalence with improved type safety and cross-platform compatibility.

### Scripts to Convert

| Original File | New File | Purpose |
|---------------|----------|---------|
| `cancel-ralph.sh` | `cancel-ralph.ts` | Cancel active Ralph loop |
| `log-ralph-prompt.sh` | `log-ralph-prompt.ts` | Log user prompts for debugging |
| `setup-ralph-loop.sh` | `ralph-loop.ts` | Initialize Ralph loop state |
| `start-ralph-session.sh` | `start-ralph-session.ts` | Session start hook |
| `run.cmd` | (Keep as-is) | Polyglot Windows/Unix wrapper |

### Naming Conventions (from `.opencode` and `.claude`)

| Pattern | Convention | Example |
|---------|------------|---------|
| State files | `*.local.md` with YAML frontmatter | `.github/ralph-loop.local.md` |
| Scripts | kebab-case `.ts` | `cancel-ralph.ts`, `ralph-loop.ts` |
| Log directories | kebab-case | `.github/logs/` |
| Log files | JSONL format | `ralph-sessions.jsonl` |

---

## Detailed Findings

### 1. Bun Shell Scripting APIs

#### 1.1 Bun.$ (Shell API)

The primary API for running shell commands from TypeScript with bash-like syntax.

**Basic Usage:**
```typescript
import { $ } from "bun";

// Run command and get output as text
const output = await $`echo "Hello World!"`.text();

// Get output as JSON
const json = await $`echo '{"foo": "bar"}'`.json();

// Suppress output (quiet mode)
const { stdout, stderr } = await $`echo "Hello!"`.quiet();
```

**Error Handling:**
```typescript
// Default: throws ShellError on non-zero exit
try {
  const output = await $`command-that-fails`.text();
} catch (err) {
  console.log(`Failed with code ${err.exitCode}`);
}

// Use .nothrow() to prevent throwing (like `|| true`)
const { exitCode } = await $`command-that-fails`.nothrow().quiet();
```

**Environment Variables:**
```typescript
// Set env vars for a command
await $`echo $FOO`.env({ ...process.env, FOO: "bar" });
```

**Sources:**
- [Bun Shell Documentation](https://bun.sh/docs/runtime/shell)
- [Bun.$ API Reference](https://bun.sh/reference/bun/$)

#### 1.2 Bun.file() and Bun.write() (File I/O)

**Reading Files:**
```typescript
// Read as text
const text = await Bun.file("foo.txt").text();

// Read and parse JSON (replaces jq)
const json = await Bun.file("config.json").json();

// Check existence
const exists = await Bun.file("foo.txt").exists();
```

**Writing Files:**
```typescript
// Write string to file
await Bun.write("output.txt", "Hello World!");

// Write JSON with formatting
await Bun.write("config.json", JSON.stringify(data, null, 2));
```

**Atomic Writes (with temp file rename):**
```typescript
import { renameSync } from "fs";

const tempFile = `${stateFile}.tmp`;
await Bun.write(tempFile, JSON.stringify(state, null, 2));
renameSync(tempFile, stateFile);
```

**Appending to Files:**
```typescript
// Bun.write() doesn't support append - read, concat, write
const existing = await Bun.file(logFile).text().catch(() => "");
await Bun.write(logFile, existing + JSON.stringify(entry) + "\n");
```

**Sources:**
- [Bun File I/O Documentation](https://bun.sh/docs/runtime/file-io)
- [Bun.write API Reference](https://bun.sh/reference/bun/write)

#### 1.3 Bun.stdin (Reading Standard Input)

```typescript
// Read entire stdin as text (replaces `cat`)
const input = await Bun.stdin.text();

// Parse JSON from stdin (replaces `jq`)
const jsonInput = await Bun.stdin.json();
```

#### 1.4 Bun.spawn() (Process Spawning)

**Background Processes (nohup equivalent):**
```typescript
// Spawn and detach (parent can exit)
const proc = Bun.spawn(["long-running-command"]);
proc.unref();

// Redirect output to file
const proc = Bun.spawn(["command"], {
  stdout: Bun.file("output.log"),
  stderr: Bun.file("output.log"),
  stdin: "ignore",
});
```

**Important:** By default, parent waits for children. Use `proc.unref()` to detach.

**Sources:**
- [Bun Spawn Documentation](https://bun.sh/docs/api/spawn)
- [Bun.spawn API Reference](https://bun.sh/reference/bun/spawn)

---

### 2. Existing TypeScript Patterns in Codebase

The codebase already has TypeScript implementations that serve as templates:

| File | Location | Pattern Type |
|------|----------|--------------|
| `telemetry-stop.ts` | `.claude/hooks/` | Claude Code hook |
| `stop-hook.ts` | `.github/hooks/` | Copilot CLI hook |
| `telemetry.ts` | `.opencode/plugin/` | OpenCode plugin |
| `ralph.ts` | `.opencode/plugin/` | OpenCode plugin |

#### Key Patterns from Existing Code

**Shebang:**
```typescript
#!/usr/bin/env bun
```

**Stdin Reading (from `.github/hooks/stop-hook.ts:415`):**
```typescript
const input = await Bun.stdin.text();
let timestamp = "";
let cwd = "";

try {
  const parsed = JSON.parse(input) as HookInput;
  timestamp = parsed?.timestamp || "";
  cwd = parsed?.cwd || "";
} catch {
  // Continue with defaults
}
```

**State File with YAML Frontmatter (from `.opencode/plugin/ralph.ts:119-168`):**
```typescript
function parseRalphState(directory: string): RalphState | null {
  const statePath = join(directory, STATE_FILE);
  if (!existsSync(statePath)) return null;

  const content = readFileSync(statePath, "utf-8").replace(/\r\n/g, "\n");
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;

  const [, frontmatter, prompt] = frontmatterMatch;

  const getValue = (key: string): string | null => {
    const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    if (!match) return null;
    return match[1].replace(/^["'](.*)["']$/, "$1");
  };

  return {
    active: getValue("active") === "true",
    iteration: parseInt(getValue("iteration") || "1", 10),
    // ...
  };
}
```

**Writing State File (from `.opencode/plugin/ralph.ts:170-189`):**
```typescript
function writeRalphState(directory: string, state: RalphState): void {
  const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.maxIterations}
completion_promise: ${state.completionPromise === null ? "null" : `"${state.completionPromise}"`}
feature_list_path: ${state.featureListPath}
started_at: "${state.startedAt}"
---

${state.prompt}
`;
  writeFileSync(statePath, content, "utf-8");
}
```

**Background Process Spawn (from `.github/hooks/stop-hook.ts:552-560`):**
```typescript
Bun.spawn(["bash", "-c", `
  sleep 2
  cd '${currentDir}'
  echo '${escapedPrompt}' | copilot --allow-all-tools --allow-all-paths
`], {
  stdout: Bun.file(spawnLogFile),
  stderr: Bun.file(spawnLogFile),
  stdin: "ignore",
});
```

---

### 3. Complete Conversion Mapping

#### 3.1 Shell Error Handling → TypeScript

| Bash Pattern | TypeScript Equivalent |
|--------------|----------------------|
| `set -e` | try/catch blocks |
| `set -u` | TypeScript strict mode + optional chaining |
| `set -o pipefail` | async/await error propagation |
| `command \|\| true` | `.nothrow()` or empty catch |

**Example:**
```bash
# Bash
set -euo pipefail
if ! some_command; then
  echo "Failed" >&2
  exit 1
fi
```

```typescript
// TypeScript
try {
  await $`some_command`.quiet();
} catch {
  console.error("Failed");
  process.exit(1);
}
```

#### 3.2 jq → Native JSON

| jq Command | TypeScript Equivalent |
|------------|----------------------|
| `jq -r '.field'` | `JSON.parse(input).field` or `await file.json()` |
| `jq -r '.field // empty'` | `parsed?.field \|\| ""` |
| `jq -r '.field // "default"'` | `parsed?.field ?? "default"` |
| `jq -n --arg k v '{k: $k}'` | `{ k: v }` object literal |
| `jq '. + {new: val}'` | `{ ...obj, new: val }` spread |
| `echo "$json" \| jq '.array[]'` | `json.array.forEach(...)` |

**Example:**
```bash
# Bash with jq
INPUT=$(cat)
TIMESTAMP=$(echo "$INPUT" | jq -r '.timestamp // empty')
VALUE=$(echo "$INPUT" | jq -r '.value // "default"')
```

```typescript
// TypeScript
const input = await Bun.stdin.text();
const parsed = JSON.parse(input);
const timestamp = parsed?.timestamp || "";
const value = parsed?.value ?? "default";
```

#### 3.3 File Operations

| Bash Pattern | TypeScript Equivalent |
|--------------|----------------------|
| `cat file.txt` | `await Bun.file("file.txt").text()` |
| `cat file.json \| jq .` | `await Bun.file("file.json").json()` |
| `echo "text" > file` | `await Bun.write("file", "text")` |
| `echo "text" >> file` | Read + concat + write (see above) |
| `mv temp file` | `renameSync(temp, file)` from `fs` |
| `rm -f file` | `try { unlinkSync(file) } catch {}` |
| `mkdir -p dir` | `mkdirSync(dir, { recursive: true })` |
| `[[ -f file ]]` | `existsSync(file)` |

#### 3.4 Process Spawning

| Bash Pattern | TypeScript Equivalent |
|--------------|----------------------|
| `nohup cmd &` | `Bun.spawn([...]).unref()` |
| `cmd > file 2>&1` | `{ stdout: Bun.file(...), stderr: Bun.file(...) }` |
| `cmd &>/dev/null` | `{ stdout: "ignore", stderr: "ignore" }` |
| `pkill -f pattern` | `await $\`pkill -f pattern\`.nothrow()` |
| `command -v cmd` | `await $\`command -v cmd\`.quiet()` |

#### 3.5 Variables and Platform Detection

| Bash Pattern | TypeScript Equivalent |
|--------------|----------------------|
| `${VAR:-default}` | `process.env.VAR \|\| "default"` |
| `$OSTYPE == darwin*` | `process.platform === "darwin"` |
| `date -u +"%Y-%m-%dT%H:%M:%SZ"` | `new Date().toISOString().replace(/\.\d{3}Z$/, "Z")` |
| `uuidgen` | `randomUUID()` from `crypto` |

---

### 4. Script-by-Script Conversion Guide

#### 4.1 cancel-ralph.sh → cancel-ralph.ts

**Current Functionality:**
- Removes state file and continue flag
- Kills orphaned copilot processes
- Archives state to logs directory

**TypeScript Structure:**
```typescript
#!/usr/bin/env bun

import { existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_CONTINUE_FILE = ".github/ralph-continue.flag";
const RALPH_LOG_DIR = ".github/logs";

async function main() {
  // Check if Ralph loop is active
  if (!existsSync(RALPH_STATE_FILE)) {
    console.log("No active Ralph loop found.");
    // Try to kill orphaned processes
    await Bun.$`pkill -f "copilot"`.nothrow().quiet();
    process.exit(0);
  }

  // Read and archive state
  const state = await Bun.file(RALPH_STATE_FILE).text();
  // ... parse YAML frontmatter ...

  // Archive state file
  mkdirSync(RALPH_LOG_DIR, { recursive: true });
  const archiveFile = join(RALPH_LOG_DIR, `ralph-loop-cancelled-${timestamp}.md`);
  await Bun.write(archiveFile, state + `\ncancelled_at: "${new Date().toISOString()}"\n`);

  // Remove state files
  try { unlinkSync(RALPH_STATE_FILE); } catch {}
  try { unlinkSync(RALPH_CONTINUE_FILE); } catch {}

  // Kill processes
  await Bun.$`pkill -f "copilot"`.nothrow().quiet();
  await Bun.$`pkill -f "sleep.*copilot"`.nothrow().quiet();

  console.log(`Cancelled Ralph loop`);
}

main();
```

#### 4.2 log-ralph-prompt.sh → log-ralph-prompt.ts

**Current Functionality:**
- Reads hook input from stdin
- Logs user prompts to JSONL file
- Shows iteration context if Ralph loop active

**TypeScript Structure:**
```typescript
#!/usr/bin/env bun

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

interface HookInput {
  timestamp?: string;
  cwd?: string;
  prompt?: string;
}

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_LOG_DIR = ".github/logs";

async function main() {
  // Read hook input from stdin
  const input = await Bun.stdin.text();

  let timestamp = "";
  let cwd = "";
  let prompt = "";

  try {
    const parsed = JSON.parse(input) as HookInput;
    timestamp = parsed?.timestamp || "";
    cwd = parsed?.cwd || "";
    prompt = parsed?.prompt || "";
  } catch {
    // Continue with defaults
  }

  // Ensure log directory exists
  mkdirSync(RALPH_LOG_DIR, { recursive: true });

  // Log entry
  const logEntry = {
    timestamp,
    event: "user_prompt_submitted",
    cwd,
    prompt,
  };

  const logFile = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");
  const existing = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existing + JSON.stringify(logEntry) + "\n");

  // Show iteration context if active
  if (existsSync(RALPH_STATE_FILE)) {
    const state = parseRalphState(RALPH_STATE_FILE);
    if (state && process.env.RALPH_LOG_LEVEL === "DEBUG") {
      console.error(`Ralph loop iteration ${state.iteration} - Prompt received`);
    }
  }

  process.exit(0);
}

main();
```

#### 4.3 setup-ralph-loop.sh → ralph-loop.ts

**Current Functionality:**
- Parses CLI arguments (--max-iterations, --completion-promise, --feature-list)
- Creates state file with YAML frontmatter
- Creates continue flag file
- Outputs setup message

**TypeScript Structure:**
```typescript
#!/usr/bin/env bun

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

interface RalphOptions {
  maxIterations: number;
  completionPromise: string | null;
  featureListPath: string;
  prompt: string;
}

const STATE_FILE = ".github/ralph-loop.local.md";
const CONTINUE_FILE = ".github/ralph-continue.flag";
const DEFAULT_FEATURE_LIST = "research/feature-list.json";

const DEFAULT_PROMPT = `You are tasked with implementing a SINGLE feature...`;

function parseArgs(): RalphOptions {
  const args = process.argv.slice(2);
  let maxIterations = 0;
  let completionPromise: string | null = null;
  let featureListPath = DEFAULT_FEATURE_LIST;
  const promptParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "-h":
      case "--help":
        showHelp();
        process.exit(0);
      case "--max-iterations":
        maxIterations = parseInt(args[++i], 10);
        break;
      case "--completion-promise":
        completionPromise = args[++i];
        break;
      case "--feature-list":
        featureListPath = args[++i];
        break;
      default:
        promptParts.push(args[i]);
    }
  }

  return {
    maxIterations,
    completionPromise,
    featureListPath,
    prompt: promptParts.length > 0 ? promptParts.join(" ") : DEFAULT_PROMPT,
  };
}

function showHelp() {
  console.log(`Ralph Loop - Interactive development loop

USAGE:
  bun ralph-loop.ts [PROMPT...] [OPTIONS]

OPTIONS:
  --max-iterations <n>           Maximum iterations (default: unlimited)
  --completion-promise '<text>'  Promise phrase to detect completion
  --feature-list <path>          Path to feature list JSON
  -h, --help                     Show this help
`);
}

async function main() {
  const options = parseArgs();

  // Validate feature list exists when using default prompt
  if (options.prompt === DEFAULT_PROMPT && !existsSync(options.featureListPath)) {
    console.error(`Error: Feature list not found at: ${options.featureListPath}`);
    process.exit(1);
  }

  // Create state directory
  mkdirSync(".github", { recursive: true });

  // Write state file with YAML frontmatter
  const stateContent = `---
active: true
iteration: 1
max_iterations: ${options.maxIterations}
completion_promise: ${options.completionPromise === null ? "null" : `"${options.completionPromise}"`}
feature_list_path: ${options.featureListPath}
started_at: "${new Date().toISOString()}"
---

${options.prompt}
`;

  await Bun.write(STATE_FILE, stateContent);
  await Bun.write(CONTINUE_FILE, options.prompt);

  // Output setup message
  console.log(`Ralph loop activated!

Iteration: 1
Max iterations: ${options.maxIterations > 0 ? options.maxIterations : "unlimited"}
Completion promise: ${options.completionPromise || "none"}
Feature list: ${options.featureListPath}

State file: ${STATE_FILE}
Continue flag: ${CONTINUE_FILE}
`);
}

main();
```

#### 4.4 start-ralph-session.sh → start-ralph-session.ts

**Current Functionality:**
- Reads hook input from stdin
- Logs session start to JSONL
- Increments iteration on resume/startup

**TypeScript Structure:**
```typescript
#!/usr/bin/env bun

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";

interface HookInput {
  timestamp?: string;
  cwd?: string;
  source?: string;
  initialPrompt?: string;
}

const RALPH_STATE_FILE = ".github/ralph-loop.local.md";
const RALPH_LOG_DIR = ".github/logs";

function parseRalphState(filePath: string) {
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  const [, frontmatter, prompt] = match;

  const getValue = (key: string): string | null => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
    return m ? m[1].replace(/^["'](.*)["']$/, "$1") : null;
  };

  return {
    active: getValue("active") === "true",
    iteration: parseInt(getValue("iteration") || "1", 10),
    maxIterations: parseInt(getValue("max_iterations") || "0", 10),
    completionPromise: getValue("completion_promise"),
    prompt: prompt.trim(),
  };
}

async function main() {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const projectRoot = join(scriptDir, "../..");

  // Read hook input
  const input = await Bun.stdin.text();

  let timestamp = "";
  let cwd = "";
  let source = "unknown";
  let initialPrompt = "";

  try {
    const parsed = JSON.parse(input) as HookInput;
    timestamp = parsed?.timestamp || "";
    cwd = parsed?.cwd || "";
    source = parsed?.source || "unknown";
    initialPrompt = parsed?.initialPrompt || "";
  } catch {}

  // Ensure log directory exists
  mkdirSync(RALPH_LOG_DIR, { recursive: true });

  // Log session start
  const logEntry = {
    timestamp,
    event: "session_start",
    cwd,
    source,
    initialPrompt,
  };

  const logFile = join(RALPH_LOG_DIR, "ralph-sessions.jsonl");
  const existing = await Bun.file(logFile).text().catch(() => "");
  await Bun.write(logFile, existing + JSON.stringify(logEntry) + "\n");

  // Check if Ralph loop is active
  if (existsSync(RALPH_STATE_FILE)) {
    const state = parseRalphState(RALPH_STATE_FILE);
    if (state) {
      console.error(`Ralph loop active - Iteration ${state.iteration}`);

      // Increment iteration on resume
      if (source === "resume" || source === "startup") {
        const newIteration = state.iteration + 1;
        // Update state file...
        console.error(`Ralph loop continuing at iteration ${newIteration}`);
      }
    }
  }

  process.exit(0);
}

main();
```

---

### 5. Hooks Configuration Update

The `.github/hooks/hooks.json` needs to be updated to use the new TypeScript scripts:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "bun run ./.github/scripts/start-ralph-session.ts",
        "powershell": "bun run ./.github/scripts/start-ralph-session.ts",
        "cwd": ".",
        "timeoutSec": 10
      }
    ],
    "userPromptSubmitted": [
      {
        "type": "command",
        "bash": "bun run ./.github/scripts/log-ralph-prompt.ts",
        "powershell": "bun run ./.github/scripts/log-ralph-prompt.ts",
        "cwd": ".",
        "timeoutSec": 10
      }
    ],
    "sessionEnd": [
      {
        "type": "command",
        "bash": "bun run ./.github/hooks/stop-hook.ts",
        "powershell": "bun run ./.github/hooks/stop-hook.ts",
        "cwd": ".",
        "timeoutSec": 30
      }
    ]
  }
}
```

---

## Code References

### Existing TypeScript Implementations (Templates)

| File | Purpose |
|------|---------|
| `.claude/hooks/telemetry-stop.ts` | Claude Code stop hook with stdin parsing, file I/O |
| `.github/hooks/stop-hook.ts` | Copilot CLI stop hook with Ralph loop logic |
| `.opencode/plugin/ralph.ts` | OpenCode plugin with YAML frontmatter parsing |
| `.opencode/plugin/telemetry.ts` | OpenCode plugin with command tracking |

### Key Import Patterns

```typescript
// Bun-specific
import { $ } from "bun";

// Node.js fs (for sync operations)
import { existsSync, mkdirSync, unlinkSync, renameSync, readFileSync, writeFileSync } from "fs";

// Node.js path
import { dirname, join } from "path";

// Node.js crypto
import { randomUUID } from "crypto";
```

---

## Architecture Documentation

### State File Format (`.github/ralph-loop.local.md`)

```yaml
---
active: true
iteration: 1
max_iterations: 0
completion_promise: null
feature_list_path: research/feature-list.json
started_at: "2026-01-24T19:00:00Z"
---

[Prompt content here]
```

### Log File Format (`.github/logs/ralph-sessions.jsonl`)

Each line is a JSON object:
```json
{"timestamp":"2026-01-24T19:00:00Z","event":"session_start","cwd":"/path","source":"startup"}
{"timestamp":"2026-01-24T19:01:00Z","event":"user_prompt_submitted","cwd":"/path","prompt":"/implement-feature"}
{"timestamp":"2026-01-24T19:30:00Z","event":"session_end","cwd":"/path","reason":"complete"}
```

---

## Historical Context (from research/)

- `research/docs/2026-01-23-telemetry-hook-investigation.md` - Documents hook configuration issues and correct settings.json format
- `research/docs/2026-01-23-hooks-json-history-analysis.md` - History of hooks.json evolution

---

## Related Research

- [Bun Shell Documentation](https://bun.sh/docs/runtime/shell)
- [Bun File I/O Documentation](https://bun.sh/docs/runtime/file-io)
- [Bun Spawn Documentation](https://bun.sh/docs/api/spawn)
- [oven-sh/bun GitHub Repository](https://github.com/oven-sh/bun)

---

## Open Questions

1. **Keep `run.cmd`?** - The polyglot Windows/Unix wrapper may still be useful for backwards compatibility. Consider keeping it as-is.

2. **Shared utility module?** - Currently, hooks inline their dependencies. Consider creating a shared `ralph-utils.ts` module if code duplication becomes significant.

3. **TypeScript compilation?** - Bun can run `.ts` files directly, but for distribution, consider using `bun build` to create standalone executables.
