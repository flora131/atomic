---
date: 2026-01-24 09:15:00 PST
researcher: Claude
git_commit: 99d9fd85c7c2c6f618ba2f36d5026e8fbeb89f61
branch: flora131/feature/add-anon-telem
repository: atomic
topic: "Copilot Agent Detection Refactoring - Code Removal and Instruction Header Implementation"
tags: [research, telemetry, copilot, agent-detection, refactoring]
status: complete
last_updated: 2026-01-24
last_updated_by: Claude
---

# Research: Copilot Agent Detection Refactoring

## Research Question

Update the way agent detection works for GitHub Copilot ONLY by:
1. Removing slash command detection code to eliminate bloat
2. Implementing instruction header parsing for agent detection as specified in the research document
3. Preserving event repetition (no deduplication) for Copilot sessions
4. Following GoF design principles for clean, maintainable software

## Summary

The current Copilot telemetry system uses a two-hook architecture that accumulates slash commands via a temp file. This is unnecessary for Copilot since custom agent names should be detected from `events.jsonl` instruction headers, not from user-typed slash commands. The refactoring involves:

1. **Removing** the `userPromptSubmitted` hook and its slash command accumulation logic
2. **Removing** the temp file communication pattern between prompt and stop hooks
3. **Adding** a new function to detect agents via `<agent_instructions>` parsing in Copilot's `events.jsonl`
4. **Modifying** the stop hook to use the new agent detection method

---

## Detailed Findings

### Current Architecture (To Be Removed)

#### Two-Hook Communication Pattern

The current implementation uses a **Mediator Pattern** with a temp file:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ CURRENT ARCHITECTURE (BLOAT TO REMOVE)                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  userPromptSubmitted hook (prompt-hook.sh)                              │
│       │                                                                 │
│       ▼                                                                 │
│  extract_commands(prompt) → Regex matching for /slash-commands          │
│       │                                                                 │
│       ▼                                                                 │
│  .github/telemetry-session-commands.tmp  ← Mediator (temp file)         │
│       │                                                                 │
│       ▼                                                                 │
│  sessionEnd hook (stop-hook.sh:228-238)                                 │
│       │                                                                 │
│       └── write_session_event("copilot", ACCUMULATED_COMMANDS)          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Problems with Current Approach:**
- Detects slash commands, not custom agent invocations
- Agent type hardcoded as `"copilot"` - no granularity
- Adds latency on every prompt submission via `userPromptSubmitted` hook
- Temp file is a brittle communication mechanism

---

### Code to Remove

#### 1. Remove `userPromptSubmitted` Hook Configuration

**File:** `.github/hooks/hooks.json:13-19`

Remove this entire block:
```json
"userPromptSubmitted": [
  {
    "type": "command",
    "bash": "./.github/hooks/prompt-hook.sh",
    "cwd": ".",
    "timeoutSec": 5
  }
]
```

#### 2. Delete Prompt Hook File

**File:** `.github/hooks/prompt-hook.sh` (entire file)

This file's sole purpose is slash command accumulation for telemetry. With agent detection moving to instruction header parsing, the entire file becomes unnecessary.

#### 3. Remove Temp File Logic from Stop Hook

**File:** `.github/hooks/stop-hook.sh:218, 228-232, 238`

Remove these specific lines:

```bash
# Line 218: Remove temp file path constant
COMMANDS_TEMP_FILE=".github/telemetry-session-commands.tmp"

# Lines 228-232: Remove temp file reading logic
ACCUMULATED_COMMANDS=""
if [[ -f "$COMMANDS_TEMP_FILE" ]]; then
  ACCUMULATED_COMMANDS=$(cat "$COMMANDS_TEMP_FILE" | tr '\n' ',' | sed 's/,$//')
fi

# Line 238: Remove temp file cleanup
rm -f "$COMMANDS_TEMP_FILE"
```

#### 4. Optional: Remove `extract_commands()` from Telemetry Helper (Copilot-specific)

**File:** `bin/telemetry-helper.sh:119-163`

If slash command detection is no longer needed for ANY agent type, this function can be removed. However, Claude Code still uses it via `telemetry-stop.sh`, so **keep this function** for now.

---

### Proposed Architecture (To Be Implemented)

#### Session Detection (Copilot-Only)

**Critical Context:** The `.github/hooks/stop-hook.sh` is **only invoked by GitHub Copilot CLI** via the hooks configuration in `.github/hooks/hooks.json`. This means:

- ✅ When `stop-hook.sh` runs, it's guaranteed to be a Copilot session
- ✅ Claude Code sessions use `.claude/hooks/telemetry-stop.sh` (different hook)
- ✅ OpenCode sessions use `.opencode/plugin/telemetry.ts` (different mechanism)
- ✅ No cross-contamination between agent types

**Hook Isolation by Directory:**

```
Copilot:   .github/hooks/stop-hook.sh    ← Configured in .github/hooks/hooks.json
Claude:    .claude/hooks/telemetry-stop.sh ← Configured in .claude/settings.json
OpenCode:  .opencode/plugin/telemetry.ts  ← Plugin event system
```

Therefore, the `detect_copilot_agents()` function only needs to be called from `.github/hooks/stop-hook.sh`, ensuring it **never runs for Claude or OpenCode sessions**.

#### Strategy Pattern for Agent Detection

Following GoF principles, implement a **Strategy Pattern** for agent detection:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ PROPOSED ARCHITECTURE                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  sessionEnd hook (stop-hook.sh)                                         │
│       │                                                                 │
│       ├── detect_copilot_agents()  ← NEW FUNCTION                       │
│       │        │                                                        │
│       │        ├── Find latest session: ~/.copilot/session-state/       │
│       │        ├── Parse events.jsonl                                   │
│       │        ├── Extract from <agent_instructions> headers            │
│       │        └── Filter to .github/agents/*.md matches                │
│       │                                                                 │
│       └── write_session_event("copilot", DETECTED_AGENTS)               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### Implementation Path

#### Step 1: Create Agent Detection Function

Add to `bin/telemetry-helper.sh`:

```bash
# Agent instruction header patterns
# Maps the header text in <agent_instructions> to the agent name
# Format: "Header Text:agent-name"
declare -A AGENT_INSTRUCTION_HEADERS=(
  ["Analyze and Explain Code Functionality"]="explain-code"
  ["Research Codebase"]="research-codebase"
  ["Create Specification"]="create-spec"
  ["Create Feature List"]="create-feature-list"
  ["Implement Feature"]="implement-feature"
  ["Create Commit"]="commit"
  ["Create GitHub Pull Request"]="create-gh-pr"
  # Add all mappings for agents under .github/agents
)

# Detect agents from Copilot session events.jsonl
# Usage: detect_copilot_agents
# Output: comma-separated list of detected agent names
detect_copilot_agents() {
  local copilot_state_dir="$HOME/.copilot/session-state"

  # Early exit if Copilot state directory doesn't exist
  if [[ ! -d "$copilot_state_dir" ]]; then
    return
  fi

  # Find the most recent session directory
  local latest_session
  latest_session=$(ls -td "$copilot_state_dir"/*/ 2>/dev/null | head -1)

  if [[ -z "$latest_session" ]]; then
    return
  fi

  local events_file="$latest_session/events.jsonl"

  if [[ ! -f "$events_file" ]]; then
    return
  fi

  local found_agents=()

  # Parse events.jsonl line by line
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Check for user.message events with transformedContent
    local event_type
    event_type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

    if [[ "$event_type" == "user.message" ]]; then
      local transformed_content
      transformed_content=$(echo "$line" | jq -r '.data.transformedContent // empty' 2>/dev/null)

      if [[ "$transformed_content" == *"<agent_instructions>"* ]]; then
        # Extract agent from instruction header
        for header in "${!AGENT_INSTRUCTION_HEADERS[@]}"; do
          if [[ "$transformed_content" == *"$header"* ]]; then
            local agent_name="${AGENT_INSTRUCTION_HEADERS[$header]}"
            # Only include if .github/agents/<agent>.md exists
            if [[ -f ".github/agents/${agent_name}.md" ]]; then
              found_agents+=("$agent_name")
            fi
          fi
        done
      fi
    fi

    # Also check assistant.message for explicit agent_type (natural language invocation)
    # This handles "use explain-code to..." style invocations
    if [[ "$event_type" == "assistant.message" ]]; then
      # Extract agent_type from task tool calls
      local agent_types
      agent_types=$(echo "$line" | jq -r '.data.toolRequests[]? | select(.name == "task") | .arguments.agent_type // empty' 2>/dev/null)

      for agent_name in $agent_types; do
        if [[ -n "$agent_name" ]] && [[ -f ".github/agents/${agent_name}.md" ]]; then
          found_agents+=("$agent_name")
        fi
      done
    fi

  done < "$events_file"

  # Return comma-separated list (preserving duplicates per requirement)
  printf '%s\n' "${found_agents[@]}" | tr '\n' ',' | sed 's/,$//'
}
```

#### Step 2: Modify Stop Hook to Use New Detection

Replace the telemetry section in `.github/hooks/stop-hook.sh`:

**Before (lines 217-243):**
```bash
TELEMETRY_HELPER="$PROJECT_ROOT/bin/telemetry-helper.sh"
COMMANDS_TEMP_FILE=".github/telemetry-session-commands.tmp"

if [[ -f "$TELEMETRY_HELPER" ]]; then
  source "$TELEMETRY_HELPER"

  if is_telemetry_enabled; then
    ACCUMULATED_COMMANDS=""
    if [[ -f "$COMMANDS_TEMP_FILE" ]]; then
      ACCUMULATED_COMMANDS=$(cat "$COMMANDS_TEMP_FILE" | tr '\n' ',' | sed 's/,$//')
    fi

    write_session_event "copilot" "$ACCUMULATED_COMMANDS"

    rm -f "$COMMANDS_TEMP_FILE"

    spawn_upload_process
  fi
fi
```

**After:**
```bash
TELEMETRY_HELPER="$PROJECT_ROOT/bin/telemetry-helper.sh"

if [[ -f "$TELEMETRY_HELPER" ]]; then
  source "$TELEMETRY_HELPER"

  if is_telemetry_enabled; then
    # Detect agents from Copilot session events.jsonl
    DETECTED_AGENTS=$(detect_copilot_agents)

    # Write session event with detected agents
    write_session_event "copilot" "$DETECTED_AGENTS"

    spawn_upload_process
  fi
fi
```

#### Step 3: Update hooks.json

**Before:**
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [...],
    "userPromptSubmitted": [
      {
        "type": "command",
        "bash": "./.github/hooks/prompt-hook.sh",
        "cwd": ".",
        "timeoutSec": 5
      }
    ],
    "sessionEnd": [...]
  }
}
```

**After:**
```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [...],
    "sessionEnd": [...]
  }
}
```

---

### Design Patterns Applied (GoF)

#### 1. Strategy Pattern

The `detect_copilot_agents()` function encapsulates the agent detection algorithm, making it interchangeable if detection logic needs to change.

**Interface Segregation:** Each agent type (Claude, OpenCode, Copilot) can have its own detection strategy without affecting others.

#### 2. Template Method Pattern

The `write_session_event()` function provides a template for event creation:
1. Check telemetry enabled (invariant step)
2. Generate IDs and timestamps (invariant step)
3. Accept agent type and commands as parameters (variant step)
4. Write to JSONL file (invariant step)

#### 3. Null Object Pattern

When no agents are detected, return empty string rather than null/error. This allows downstream code to handle the "no agents" case uniformly.

#### 4. Single Responsibility Principle

Each function has one job:
- `detect_copilot_agents()` - Detect agents from events.jsonl
- `write_session_event()` - Write telemetry event
- `is_telemetry_enabled()` - Check consent status

---

### Instruction Header Mapping

The agent markdown files use a consistent pattern. The H1 header in each file maps to the instruction text injected into `transformedContent`:

| Agent File | H1 Header | Agent Name |
|------------|-----------|------------|
| `.github/agents/explain-code.md:14` | "# Analyze and Explain Code Functionality" | `explain-code` |
| `.github/agents/research-codebase.md` | (needs verification) | `research-codebase` |
| `.github/agents/create-spec.md` | (needs verification) | `create-spec` |
| `.github/agents/commit.md` | (needs verification) | `commit` |

**Recommendation:** Build the `AGENT_INSTRUCTION_HEADERS` mapping by parsing the H1 headers from all `.github/agents/*.md` files programmatically at initialization time.

---

### Event Structure Considerations

The current `AgentSessionEvent` schema uses `commands` field for slash commands:

```typescript
interface AgentSessionEvent {
  agentType: AgentType;      // "copilot"
  commands: string[];        // Currently: ["/commit", "/create-gh-pr"]
  commandCount: number;
}
```

**For Copilot with agent detection, repurpose as:**
```typescript
interface AgentSessionEvent {
  agentType: AgentType;      // "copilot"
  commands: string[];        // Now: ["explain-code", "commit"]
  commandCount: number;      // Count of agent invocations
}
```

The `commands` field name is slightly misleading but maintains backward compatibility. Consider renaming to `invocations` in a future major version.

---

## Code References

### Files to Modify

| File | Lines | Change |
|------|-------|--------|
| `.github/hooks/hooks.json` | 13-19 | Remove `userPromptSubmitted` hook |
| `.github/hooks/stop-hook.sh` | 217-243 | Replace temp file logic with agent detection |
| `bin/telemetry-helper.sh` | (new) | Add `detect_copilot_agents()` function |

### Files to Delete

| File | Reason |
|------|--------|
| `.github/hooks/prompt-hook.sh` | No longer needed - slash command accumulation removed |

### Files to Keep Unchanged

| File | Reason |
|------|--------|
| `.claude/hooks/telemetry-stop.sh` | Claude Code still uses slash command detection |
| `.opencode/plugin/telemetry.ts` | OpenCode uses different event model |
| `src/utils/telemetry/*.ts` | TypeScript code unaffected by bash-side changes |

---

## Architecture Documentation

### Current Flow (Before Refactoring)

```
Copilot Session Start
       │
       ▼
┌──────────────────────┐
│ userPromptSubmitted  │ ──► prompt-hook.sh ──► extract_commands() ──► temp file
└──────────────────────┘
       │ (repeats for each prompt)
       ▼
┌──────────────────────┐
│ sessionEnd           │ ──► stop-hook.sh ──► read temp file ──► write_session_event("copilot", commands)
└──────────────────────┘
```

### Proposed Flow (After Refactoring)

```
Copilot Session Start
       │
       │ (no prompt hooks)
       ▼
┌──────────────────────┐
│ sessionEnd           │ ──► stop-hook.sh ──► detect_copilot_agents() ──► write_session_event("copilot", agents)
└──────────────────────┘
                                    │
                                    ├── Read ~/.copilot/session-state/<latest>/events.jsonl
                                    │
                                    ├── Method 1 (Dropdown/CLI):
                                    │   └── Parse user.message for <agent_instructions> in transformedContent
                                    │
                                    ├── Method 2 (Natural Language):
                                    │   └── Parse assistant.message for task tool call with agent_type
                                    │
                                    └── Filter to .github/agents/*.md matches
```

---

## Historical Context (from research/)

### Related Research Documents

- `research/docs/2026-01-24-copilot-agent-detection-findings.md` - Original investigation finding the detection patterns
- `research/docs/2026-01-24-copilot-agent-session-detection.md` - Session state directory discovery
- `research/docs/2026-01-23-telemetry-hook-investigation.md` - Hook configuration debugging
- `research/docs/2026-01-21-anonymous-telemetry-implementation.md` - Original telemetry design

---

## Open Questions

1. **Header Mapping Maintenance:** Should the `AGENT_INSTRUCTION_HEADERS` mapping be generated dynamically by parsing `.github/agents/*.md` files, or maintained as a static lookup table?

2. **Event Schema Evolution:** Should we add explicit `agents` and `agentCount` fields to `AgentSessionEvent` for semantic clarity, or continue reusing `commands`/`commandCount`?

3. **Cross-Session Detection:** The current approach only reads the most recent session. If Copilot allows spawning sub-sessions, should we track all active sessions?

4. **Performance:** Reading `events.jsonl` at session end adds latency. Is this acceptable, or should we consider a caching strategy?

5. **Windows Support:** The `stop-hook.ps1` PowerShell equivalent needs parallel updates. Is Windows Copilot support a priority?
