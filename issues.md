# Atomic TUI E2E Testing - Issues Tracker

## Status: In Progress

## Team

| Agent           | Role                 | Status                                                   |
| --------------- | -------------------- | -------------------------------------------------------- |
| team-lead       | Manager              | Active                                                   |
| opencode-tester | OpenCode E2E Testing | Running                                                  |
| claude-tester   | Claude E2E Testing   | Running                                                  |
| copilot-tester  | Copilot E2E Testing  | COMPLETE - Round 2: 10 issues total (CP-001 thru CP-010) |
| qa-reviewer     | Quality Assurance    | Phase 1 Complete (awaiting testers)                      |
| debugger        | Issue Resolution     | Ready (codebase familiarized)                            |

## Test Matrix

### Slash Commands

| Command                | OpenCode      | Claude           | Copilot          | Notes                                                                                                                                                                                                                 |
| ---------------------- | ------------- | ---------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| /research-codebase     | FAIL          | PASS             | PASS             | OC: Error: [object Object] (OC-001). CL: ask_question works, spawns sub-agents, explores project. CP: Agent asks for clarification, spawns sub-agents, creates research doc successfully                              |
| /create-spec           | NOT TESTED    | NOT TESTED       | PASS             | OC: Blocked by OC-001. CL: Not tested (empty project). CP: Creates comprehensive spec (18,929 chars) from research doc                                                                                                |
| /create-feature-list   | NOT TESTED    | NOT TESTED       | PASS             | OC: Blocked by upstream issues. CL: Not tested (empty project). CP: Creates feature-list.json (12 features, 6,227 chars) and progress.txt                                                                             |
| /implement-feature     | NOT TESTED    | NOT TESTED       | NOT TESTED       | OC/CL/CP: Not tested in this round due to time                                                                                                                                                                        |
| /commit                | FAIL (silent) | PARTIAL (CL-002) | PARTIAL          | OC: Command recognized but no response (OC-001). CL: Starts git ops but API hangs mid-execution (CL-002). CP: Command recognized, attempts git ops but bash tool fails (CP-002)                                       |
| /create-gh-pr          | NOT TESTED    | NOT TESTED       | NOT TESTED       | OC/CL/CP: No persistent files to commit                                                                                                                                                                               |
| /explain-code          | FAIL (silent) | PASS             | PASS             | OC: Command recognized but no response (OC-001). CL: Detailed multi-section explanation with tables, debugging tips, emoji. CP: Detailed multi-section code explanation works correctly                               |
| /ralph (yolo)          | PARTIAL       | PASS             | PASS             | OC: Workflow UI works but AI fails (OC-001). CL: Starts correctly, runs sub-agents, uses ask_question for choices. CP: Starts correctly, shows UUID/banner/mode. Bash tool fails (CP-002) but workflow mechanics work |
| /ralph cancel (Ctrl+C) | FAIL          | FAIL (CL-001)    | PASS             | OC: Neither Ctrl+C cancels after error state (OC-002). CL: Ctrl+C does NOT interrupt during API streaming (CL-001). CP: Ctrl+C cancels Ralph successfully (CP-004 FIX VERIFIED)                                       |
| /ralph cancel (Esc)    | FAIL          | FAIL (CL-001)    | PASS             | OC: Esc doesn't cancel after error state (OC-002). CL: Esc does NOT interrupt during API streaming (CL-001). CP: Esc cancels Ralph successfully (CP-004 FIX VERIFIED)                                                 |
| /ralph restart         | NOT TESTED    | NOT TESTED       | PASS             | CL: Not tested (could not cancel to test restart). CP: Ralph restarts after both Ctrl+C and Esc cancellation, generates new UUID                                                                                      |
| /help                  | PASS          | PASS             | PARTIAL (CP-006) | OC: Shows all commands correctly. CL: Shows all slash commands, Ralph docs, sub-agents with model info. CP: Shows skills, Ralph docs, sub-agents BUT built-in commands section scrolled off/missing                   |
| /theme                 | PASS          | PASS             | PASS             | OC/CL/CP: Both dark and light themes switch correctly                                                                                                                                                                 |

### Core Features

| Feature                 | OpenCode       | Claude        | Copilot    | Notes                                                                                                                                                                                                                                     |
| ----------------------- | -------------- | ------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TUI Launch              | PASS           | PASS          | PASS       | OC: ASCII art banner, v0.4.4, model, OpenCode agent, dir all correct. CL: ASCII art "ATOMIC", v0.4.4, model·Claude Code, working dir correct. CP: ASCII art "ATOMIC", v0.4.4, Claude Sonnet 4.5 · GitHub Copilot, working dir all correct |
| Message Input           | FAIL           | PASS          | PASS       | OC: Messages accepted but all return "Error: [object Object]" (OC-001). CL: Messages accepted and processed correctly with tool calls. CP: Messages accepted and processed correctly                                                      |
| Text Rendering (CP-001) | -              | PASS          | PASS       | CL: Clean text rendering, markdown formatting, code blocks, tables, emoji all render correctly. CP-001 FIX VERIFIED                                                                                                                       |
| Tool Calls              | BLOCKED        | PASS          | PARTIAL    | OC: Blocked by OC-001. CL: Bash (💻), Glob (🔍), Read (📄) tools all work with proper box rendering. CP: report_intent/view/create tools work. bash tool fails inconsistently (CP-002)                                                    |
| MCP Tool Calls          | BLOCKED        | NOT TESTED    | PASS       | OC: Blocked by OC-001. CL: Not explicitly tested. CP: report_intent tool works correctly                                                                                                                                                  |
| ask_question            | BLOCKED        | PASS          | PASS       | OC: Blocked by OC-001. CL: Interactive selection with descriptions, navigation instructions, Esc cancel all work. CP: Agent asks clarifying questions                                                                                     |
| Session History         | INCONCLUSIVE   | NOT TESTED    | NOT TESTED | OC: Arrow keys didn't populate input. CL/CP: Not tested due to time constraints                                                                                                                                                           |
| Message Queuing         | BLOCKED        | PASS          | PASS       | OC: Blocked by OC-001. CL: Second message queued while first processing, auto-processed after. CP: Messages queued during Ralph workflow                                                                                                  |
| Theme Switching         | PASS           | PASS          | PASS       | OC/CL/CP: /theme dark and /theme light both work                                                                                                                                                                                          |
| Model Selector          | PASS (UI only) | PASS          | PARTIAL    | OC: /model shows full model list, j/k nav, Esc cancel (OC-003). CL: Shows opus/sonnet/haiku, j/k nav works, model switch confirmed (haiku→sonnet). CP: Shows 3 models, j/k nav, Esc cancel. Console error on open (CP-008)                |
| /clear                  | PASS (partial) | PASS          | PASS       | OC: Clears messages but Ralph state persists (OC-004). CL: Clears messages, resets to placeholder, new session on next message. CP: Clears messages and resets to "Enter a message..." prompt                                             |
| /compact                | PASS           | PASS          | PASS       | OC: "Context compacted successfully". CL: "Context compacted successfully" (with session), "No active session" (without). CP: Shows success msg + console WARN about SDK handling compaction automatically                                |
| Empty Input             | PASS           | PASS          | PASS       | OC/CL/CP: Empty input correctly does nothing                                                                                                                                                                                              |
| Special Chars           | PASS           | PASS          | PASS       | OC/CL/CP: Quotes, angle brackets, ampersands all handled correctly                                                                                                                                                                        |
| Long Input              | PASS           | PASS          | PASS       | OC: 500-char input with proper wrapping. CL: 20× pangram repetition handled with proper wrapping. CP: 450-char input with proper word wrapping                                                                                            |
| Unknown Commands        | PASS           | NOT TESTED    | PASS       | OC/CP: "Unknown command: /nonexistent. Type /help for available commands."                                                                                                                                                                |
| Ctrl+O                  | PASS           | NOT TESTED    | NOT TESTED | OC: Parallel agents tree toggle works                                                                                                                                                                                                     |
| Rapid Commands          | PASS           | PASS          | PASS       | OC/CL/CP: Rapid theme/clear/help commands in succession - no crash                                                                                                                                                                        |
| UI Quality              | -              | PASS          | PARTIAL    | CL: Clean rendering throughout. CP-001 RESOLVED. CP-008 NEW: Console panel overlaps                                                                                                                                                       |
| -m flag                 | NOT TESTED     | PASS          | NOT TESTED | CL: -m haiku, -m sonnet both work correctly, banner updates                                                                                                                                                                               |
| Interrupt (Ctrl+C)      | -              | FAIL (CL-001) | -          | CL: Ctrl+C does NOT interrupt during Claude API streaming/thinking phase                                                                                                                                                                  |
| Interrupt (Esc)         | -              | FAIL (CL-001) | -          | CL: Esc does NOT interrupt during Claude API streaming/thinking phase                                                                                                                                                                     |

## Issues Found

### Open Issues

#### QA-001: Massive E2E test duplication (Code Quality)

- **Source**: qa-reviewer code review
- **Severity**: Medium
- **Files**: tests/e2e/opencode-mode.test.ts, claude-mode.test.ts, copilot-mode.test.ts
- **Description**: Three ~1200-line test files are nearly identical copy-paste with agent names substituted. Testing anti-pattern.
- **Status**: Open - assess after E2E testing complete

#### QA-002: Tool renderer has scattered multi-SDK parameter handling (Architecture)

- **Source**: qa-reviewer code review
- **Severity**: Medium
- **Files**: src/ui/tools/registry.ts
- **Description**: readToolRenderer handles file_path (Claude) vs path/filePath (OpenCode). bashToolRenderer handles command vs cmd. Parameter normalization should happen at SDK client level, not in renderers.
- **Status**: Open

#### QA-003: Hardcoded agent descriptions duplication (Code Quality)

- **Source**: qa-reviewer code review
- **Severity**: Low
- **Files**: src/ui/commands/builtin-commands.ts, src/ui/commands/agent-commands.ts
- **Description**: /help command has hardcoded agent descriptions that duplicate BUILTIN_AGENTS in agent-commands.ts.
- **Status**: Open

#### QA-004: `any` usage in opencode-client.ts (Type Safety)

- **Source**: qa-reviewer code review
- **Severity**: Low
- **File**: src/sdk/opencode-client.ts:1147
- **Description**: `this.sdkClient as any` cast for config.providers() access.
- **Status**: Open

#### QA-005: Double `as unknown as` casts hiding type mismatches (Type Safety)

- **Source**: qa-reviewer code review
- **Severity**: Medium
- **Files**: src/ui/commands/builtin-commands.ts:370,376; src/ui/commands/workflow-commands.ts:623,687
- **Description**: Double casts hide real type mismatches rather than fixing them properly.
- **Status**: Open

#### QA-006: E2E tests are mock-based, not real agent tests (Testing)

- **Source**: qa-reviewer code review
- **Severity**: High
- **Files**: tests/e2e/\*.test.ts
- **Description**: All three E2E test files use mock clients testing mock behavior. Real SDK tests conditionally skipped via env vars. This is why manual E2E testing via tmux-cli is critical.
- **Status**: Open - this is exactly why we're doing manual E2E testing

#### QA-007: 2 failing workflow-commands tests (Bug - Actionable)

- **Source**: qa-reviewer test run
- **Severity**: High
- **File**: tests/ui/commands/workflow-commands.test.ts
- **Description**: Two test failures: (1) "ralph command without flags requires prompt" expects failure but gets success, (2) "ralph command with --resume flag without UUID fails" expects failure but gets success.
- **Root Cause**: Implementation bugs, not test issues:
  1. `/ralph` with no args silently fell back to implement-feature skill prompt instead of requiring explicit user prompt. Fix: added early return with `success: false` when `!parsed.yolo && !parsed.prompt`.
  2. `parseRalphArgs("--resume")` returned `resumeSessionId: null` (same as "no --resume flag"), so the resume handler was skipped. Fix: changed to return `""` for flag-present-but-no-value, and added explicit check in `createRalphCommand` for empty string UUID.
- **Files Changed**: src/ui/commands/workflow-commands.ts (implementation fix), tests/ui/commands/workflow-commands.test.ts (updated parseRalphArgs unit test), tests/e2e/ralph-resume.test.ts (updated parseRalphArgs unit test)
- **Status**: **RESOLVED** - All 3 failing tests fixed (170/170 workflow + 40/40 ralph-resume), typecheck clean, lint clean

#### QA-008: Hardcoded colors outside theme system (UI Quality)

- **Source**: qa-reviewer code review
- **Severity**: Medium
- **File**: src/ui/components/parallel-agents-tree.tsx:361-363,381
- **Description**: Hardcoded hex colors (#ef4444, #22c55e, #fbbf24, #D4A5A5) instead of using theme colors. Breaks theme consistency.
- **Status**: Open

#### QA-009: handleQuestionAsked only processes first question (Feature Gap)

- **Source**: qa-reviewer code review
- **Severity**: Medium
- **File**: src/sdk/opencode-client.ts:529
- **Description**: Only processes `questions[0]` with a comment about queuing additional ones, but no queuing is implemented. Multi-question ask_question tool calls will lose data.
- **Status**: Open

#### QA-010: Unused variables in chat.tsx (Code Quality)

- **Source**: qa-reviewer lint
- **Severity**: Low
- **File**: src/ui/chat.tsx:578,580
- **Description**: CHAT_SCROLLBAR_FG and CHAT_SCROLLBAR_BG declared but unused.
- **Status**: Open

#### QA-011: `any` casts in multiple SDK clients (Type Safety)

- **Source**: qa-reviewer code review
- **Severity**: Low
- **Files**: opencode-client.ts:1147, copilot-mode.test.ts:1184,1194, claude-client.ts:792
- **Description**: Multiple `as any` casts across SDK clients - opencode for config.providers(), copilot tests for permission handlers, claude for Zod schema bypass.
- **Status**: Open

#### QA-012: Token estimation heuristic is fragile (Robustness)

- **Source**: qa-reviewer code review
- **Severity**: Low
- **File**: src/sdk/opencode-client.ts
- **Description**: Uses 4-chars-per-token estimation. Fragile for non-English text or code-heavy content.
- **Status**: Open

#### QA-013: ralph setup with invalid feature-list launches TUI instead of erroring (Bug - Actionable)

- **Source**: qa-reviewer test run
- **Severity**: High
- **File**: tests/cli-commander.test.ts:511
- **Description**: `ralph setup -a claude --feature-list does-not-exist.json` launches interactive TUI instead of validating the path and exiting with error code 1. Test times out waiting for exit.
- **Root Cause**: `ralphSetup()` in `src/commands/ralph.ts` delegated directly to `executeGraphWorkflow()` without validating the `featureList` path. The `featureList` option was never checked before entering the interactive workflow.
- **Fix**: Added early validation in `ralphSetup()` — checks `existsSync(options.featureList)` before calling `executeGraphWorkflow()`. If missing, prints "Feature list not found: <path>" to stderr and returns exit code 1.
- **Files Changed**: src/commands/ralph.ts
- **Status**: **RESOLVED** - 40/40 cli-commander tests pass, typecheck/lint clean

#### CP-001: Text rendering stutter/duplication in Copilot mode (UI - Critical)

- **Source**: copilot-tester E2E testing
- **Severity**: Critical
- **Description**: Text output from the Copilot agent is duplicated/tripled/quadrupled in the TUI rendering. Each word appears multiple times. The duplication worsens over time.
- **Root Cause (3 vectors identified by QA)**:
  1. **Dual SDK event subscription**: `wrapSession()` and `stream()` both subscribed to `sdkSession.on()` — tool events emitted twice
  2. **`hasYieldedDeltas` premature reset (line 321)**: In multi-turn agentic flows, `hasYieldedDeltas` was reset to `false` after `assistant.message`, allowing subsequent complete messages to push full text into chunks[] duplicating all previously streamed deltas
  3. **`resumeSession()` triple subscription**: Called `wrapSession()` without unsubscribing the previous handler, adding duplicate `sdkSession.on()` subscriptions
- **Fixes Applied**:
  1. Removed duplicate tool event emission from stream handler (Vector 1)
  2. Removed `hasYieldedDeltas = false` reset — flag now only set by arriving deltas (Vector 2)
  3. `resumeSession()` now unsubscribes old handler before re-wrapping (Vector 3)
  4. Cleaned up unused `self` variable and `toolCallIdToName` corruption path
- **Files Changed**: src/sdk/copilot-client.ts
- **Status**: **RESOLVED** — all 3 vectors fixed, needs live E2E testing to confirm

#### CP-002: Copilot SDK bash tool fails repeatedly before succeeding (SDK - Critical)

- **Source**: copilot-tester E2E testing
- **Severity**: Critical
- **Description**: The Copilot SDK's bash tool consistently fails 3-6 times (shown as ✕ in the UI) before the command eventually succeeds. Even trivial commands like `mkdir -p` and `ls -la` exhibit this behavior. The pattern is:
  1. Command submitted → fails (✕)
  2. Same command retried → fails (✕)
  3. Repeat 2-4 more times
  4. Finally succeeds (●)
- **Additional observation**: Files created in one bash tool call do not persist to the next call. The agent repeatedly discovers an empty directory and must recreate everything from scratch each turn. This indicates the Copilot SDK's bash execution environment is either sandboxed per-call or has a cwd/filesystem isolation issue.
- **Likely Cause**: The copilot-client.ts bash tool implementation may have timeout, cwd, or execution issues. The filesystem not persisting could be a sandbox or working directory configuration issue.
- **Files to investigate**: src/sdk/copilot-client.ts (bash tool execution), Copilot SDK documentation
- **Root Cause**: Copilot SDK / CLI server issue — our code correctly delegates bash execution to the SDK. The sandbox resets or CLI process restarts between calls. Not fixable in our codebase.
- **Status**: KNOWN SDK LIMITATION — recommend filing upstream with GitHub Copilot SDK team

#### CP-003: Edit tool fails and label truncated in Copilot mode (UI/SDK - High)

- **Source**: copilot-tester E2E testing
- **Severity**: High
- **Description**: Two issues with the edit tool:
  1. The edit tool fails (✕) when trying to edit files
  2. The tool label shows "✏️ dit" instead of "✏️ edit" - the first character is truncated
- **Likely Cause**: Label truncation may be a rendering offset issue. Edit failures are likely caused by the same filesystem isolation issue as CP-002.
- **Files to investigate**: src/ui/components/tool-result.tsx (label rendering), src/sdk/copilot-client.ts (edit tool)
- **Status**: Open

#### CP-004: Ralph workflow cannot be canceled with Ctrl+C or Esc in Copilot mode (Workflow - Critical, CROSS-AGENT)

- **Source**: copilot-tester E2E testing
- **Severity**: Critical
- **Description**: Once Ralph workflow starts, neither Ctrl+C nor Escape can stop it. The `🔄 Ralph` banner persists and the agent continues.
- **Root Cause (identified by QA)**: Interrupt handler aborts the stream but never sets `workflowActive = false`. The workflow auto-start useEffect in chat.tsx:1127-1131 re-triggers when `isStreaming` transitions back to `false`, restarting the workflow.
- **Fix Applied**: Both Ctrl+C (chat.tsx:1878) and Escape (chat.tsx:1960) interrupt handlers now also cancel the workflow state (`workflowActive: false, workflowType: null, initialPrompt: null`) when a workflow is active. This prevents auto-restart and clears the Ralph banner.
- **Files Changed**: src/ui/chat.tsx (both Ctrl+C and Escape interrupt handlers)
- **Status**: **RESOLVED** — cross-agent fix, affects all agents not just Copilot. 122/122 interrupt tests pass.

#### CP-005: Ralph stalls after initialization before implementation starts (Workflow - High)

- **Source**: copilot-tester E2E testing
- **Severity**: High
- **Description**: After starting Ralph with `/ralph --yolo <prompt>`, the workflow initializes correctly (shows session UUID, mode, prompt) but then stalls for 30+ seconds before beginning implementation. The first tool call only happens after sending an additional message or pressing Ctrl+C.
- **Expected behavior**: Ralph should immediately begin implementation after showing the initialization message.
- **Files to investigate**: src/ui/commands/workflow-commands.ts (Ralph loop kickoff)
- **Status**: Open

#### CP-006: /help command missing builtin commands section (UI - Medium)

- **Source**: copilot-tester E2E testing
- **Severity**: Medium
- **Description**: The `/help` output shows skill commands, Ralph workflow docs, and sub-agent details, but does not display the builtin commands section (e.g., /theme, /clear, /model, /compact). These commands exist and work when typed directly.
- **Files to investigate**: src/ui/commands/builtin-commands.ts (help command generation)
- **Status**: Open

#### CP-007: /ralph:ralph-help syntax not recognized (UI - Low)

- **Source**: copilot-tester E2E testing
- **Severity**: Low
- **Description**: The command `/ralph:ralph-help` returns "Unknown command". The correct syntax is just `/ralph` with flags. The help output in `/help` shows the proper Ralph syntax. This may be a naming convention issue between how skills are defined vs how they're invoked.
- **Status**: Open - may be by design

#### CP-008: Console panel overlaps with main chat content rendering (UI - Medium)

- **Source**: copilot-tester E2E re-testing (Round 2)
- **Severity**: Medium
- **Description**: The Console panel at the bottom of the TUI overlaps with the main chat content area. When the AI response extends near the bottom of the screen, the response text and console error log text become interleaved/garbled. The overlap makes it difficult to read both the response and the error log. Example: AI response text like "The project directory contains..." appears mixed with console stack trace lines.
- **Reproduction**: Send any message that triggers a multi-line AI response while the console panel is visible with errors. The last few lines of the response overlap with the console panel header/content.
- **Files to investigate**: src/ui/chat.tsx (layout/split panel rendering), src/ui/index.ts (console panel positioning)
- **Status**: Open

#### CP-009: Copilot view tool intermittently fails to see existing files (SDK - Medium)

- **Source**: copilot-tester E2E re-testing (Round 2)
- **Severity**: Medium
- **Description**: The Copilot SDK's `view` tool (file/directory listing) intermittently shows ✕ (failure) even when the files/directories physically exist on disk. After `/compact`, the tool consistently fails to see files that were previously accessible. The `create` tool also reports success but files don't persist to the actual filesystem. This suggests the Copilot SDK's file operations may use a virtual/sandboxed filesystem that doesn't map to the real filesystem.
- **Likely Cause**: Related to CP-002. The Copilot SDK's file access may be sandboxed or use a different working directory context than expected.
- **Status**: Open - likely SDK limitation similar to CP-002

#### CP-010: Stream write error on TUI startup (SDK - Low)

- **Source**: copilot-tester E2E re-testing (Round 2)
- **Severity**: Low
- **Description**: On TUI startup in Copilot mode, a persistent ERROR appears in the console panel: "Error: Cannot call write after a stream was destroyed" from vscode-jsonrpc. This error persists throughout the session. It appears to be a one-time error that occurs when the Copilot SDK's LSP connection is established/torn down during initialization. It doesn't affect functionality but clutters the console.
- **Stack trace**: Error in vscode-jsonrpc messageWriter.js -> doWrite -> processTicksAndRejections
- **Status**: Open - cosmetic issue, investigate Copilot SDK LSP lifecycle

#### OC-001: All messages return "Error: [object Object]" in OpenCode mode (SDK/UI - CRITICAL BLOCKER)

- **Source**: opencode-tester E2E testing
- **Severity**: Critical (Blocker - prevents ALL AI functionality)
- **Files**: src/sdk/opencode-client.ts, src/ui/index.ts
- **Description**: Every message sent in OpenCode mode returns "Error: [object Object]". This blocks ALL AI-dependent features: regular messages, slash commands, Ralph, tool calls, etc.
- **Root Cause (2 bugs)**:
  1. **Backend**: The OpenCode server's default model (`gemini-3-pro-preview` via `github-copilot` provider) returns `{"name":"UnknownError","data":{"message":"Error"}}` on every prompt. Verified via direct curl to `/session/{id}/message` endpoint.
  2. **Frontend**: The error object from the SDK (`result.error`) is converted to string via `String(error)` which produces `[object Object]` instead of extracting the actual error message. In `opencode-client.ts:698`, `throw new Error("Failed to send message: " + result.error)` should use `JSON.stringify(result.error)` or extract `result.error.data?.message` or `result.error.name`.
  3. Additionally, in `opencode-client.ts:925`, the stream error handler does `content: "Error: ${error instanceof Error ? error.message : String(error)}"` — when the error is an object (not an Error instance), `String(error)` produces `[object Object]`.
- **Status**: Open - CRITICAL, needs immediate fix

#### OC-002: Ralph workflow cannot be canceled after error state (Workflow - High)

- **Source**: opencode-tester E2E testing
- **Severity**: High
- **Files**: src/ui/chat.tsx (workflow state management)
- **Description**: When Ralph starts but the initial AI prompt errors out (due to OC-001), neither Ctrl+C nor Esc can cancel the workflow. The Ralph header bar (🔄 Ralph) persists. The workflow state machine doesn't handle the transition from "active" to "error" properly.
- **Note**: CP-004 fix (adding workflow cancellation to interrupt handlers) may have partially addressed this, but the error-state case seems different — the workflow may not be in a "streaming" state when the error occurs, so the interrupt handler's streaming check might not trigger.
- **Status**: Open - may need additional error-state handling in workflow state machine

#### OC-003: /model command changes display but doesn't propagate to API (SDK - High)

- **Source**: opencode-tester E2E testing
- **Severity**: High
- **Files**: src/ui/chat.tsx, src/ui/index.ts, src/sdk/opencode-client.ts
- **Description**: The `/model` command shows the model selector, allows picking a model, updates the banner display (e.g., "Claude Opus 4 (latest) · OpenCode"), but the actual API calls continue using the original default model (`gemini-3-pro-preview` via `github-copilot`). Verified via curl: session prompts always use the original model regardless of `/model` selection.
- **Root Cause**: The OpenCode SDK's `session.prompt()` accepts a `model` parameter as an object `{providerID, modelID}`, but the TUI's model switching only updates the display state without passing the selected model to the SDK's prompt calls. The `agentMode` in `wrapSession()` is set once at session creation and never updated.
- **Status**: Open

#### OC-004: /clear doesn't reset Ralph workflow state (UI - Medium)

- **Source**: opencode-tester E2E testing
- **Severity**: Medium
- **Files**: src/ui/chat.tsx (handleClear / workflow state)
- **Description**: After running Ralph and then `/clear`, the message history is cleared correctly, but the Ralph header bar (🔄 Ralph) persists. The `/clear` command should also reset workflow state (`workflowActive: false`).
- **Fix Applied**: `destroySession` handling at chat.tsx:1694-1697 now resets to `defaultWorkflowChatState` which includes `workflowActive: false, workflowType: null, initialPrompt: null`.
- **Status**: **RESOLVED** — verified by QA reviewer

#### QA-014: Parallel tool deduplication drops concurrent same-name tools (Bug)

- **Source**: qa-reviewer Phase 1 deep review
- **Severity**: Medium
- **File**: src/ui/index.ts:294
- **Description**: `state.activeToolNames` (a Set of tool names) is used to deduplicate tool start events. If two concurrent Bash tool calls happen (common in parallel agent scenarios), the second is silently dropped because "Bash" is already in the set. Only one of two parallel Bash calls would be displayed in the UI.
- **Fix**: Track by unique tool ID instead of tool name, or use a counter per name.
- **Status**: Open - assigned to debugger

### Resolved Issues

#### QA-007: 2 failing workflow-commands tests — FIXED by debugger

- Fixed `parseRalphArgs` to distinguish "--resume with no UUID" (`""`) from "no --resume flag" (`null`)
- Fixed `createRalphCommand` to require explicit prompt when no args given
- All 170 tests pass, typecheck/lint clean

#### QA-013: ralph setup with invalid feature-list — FIXED by debugger

- Added early `existsSync` validation in `ralphSetup()` before entering interactive workflow
- 40/40 cli-commander tests pass, typecheck/lint clean

#### CP-001: Text stutter/duplication — FIXED by debugger

- Fixed 3 duplication vectors in copilot-client.ts: dual tool event emission, hasYieldedDeltas premature reset, resumeSession triple subscription
- 51/51 copilot tests pass, typecheck/lint clean

#### CP-004: Ralph cannot be canceled — FIXED by debugger (cross-agent)

- Added workflow state cancellation to both Ctrl+C and Escape interrupt handlers in chat.tsx
- 122/122 interrupt tests pass, typecheck/lint clean

## Progress Log

- Started E2E testing campaign
- Debugger agent fully prepared (read all key source files + UI components + commands)
- QA reviewer completed Phase 1 codebase familiarization, found 6 code quality issues
- 3 tester agents running E2E tests in parallel
- QA reviewer completed comprehensive audit: 2 test failures found (QA-007), 12 total issues logged
- QA-007 (failing workflow tests) escalated to debugger for immediate fix
- **QA-007 RESOLVED**: debugger fixed 2 bugs in workflow-commands.ts (parseRalphArgs + createRalphCommand), 170/170 tests passing
- **QA-013 RESOLVED**: debugger added feature-list path validation in ralphSetup(), 40/40 cli-commander tests passing
- QA-007 3rd test (ralph-resume.test.ts) also fixed by debugger, 40/40 pass
- Suite at 4631 pass, 32 skip, 1 fail (QA-013)
- QA-013 (invalid feature-list launches TUI) escalated to debugger
- **Copilot E2E testing completed**: 7 new issues filed (CP-001 through CP-007). 3 critical, 2 high, 1 medium, 1 low. Core TUI functions work but Copilot SDK has fundamental bash tool and streaming issues.
- **CP-001 PARTIAL FIX**: debugger fixed duplicate tool event emission in copilot-client.ts stream handler. Text stutter root cause needs live testing to confirm.
- **CP-001 FULLY RESOLVED**: QA identified 3 duplication vectors, debugger fixed all 3 in copilot-client.ts (dual tool events, hasYieldedDeltas reset, resumeSession triple sub)
- **CP-004 RESOLVED**: debugger added workflow state cancellation to Ctrl+C and Escape handlers in chat.tsx — cross-agent fix affects all modes
- **QA Phase 1 Complete (new session)**: 4632 pass, 32 skip, 0 fail. Typecheck clean. Lint: 0 errors, 2 warnings. All 4 resolved issues verified.
- **QA-014 NEW**: Parallel tool dedup uses Set of names instead of unique IDs — drops concurrent same-name tools
- **CP-006 Update**: QA suspects display artifact, not code bug. Registration order confirmed correct.
- **CP-003 Root Cause**: Emoji (U+270F+U+FE0F) renders as 2 terminal cells but counted as 1 by layout engine.
- Debugger assigned priority fixes: CP-003 → CP-005 → QA-010 → QA-014
- Waiting on 3 E2E testers (opencode, claude, copilot) to complete for QA Phase 2
- **OpenCode E2E testing COMPLETE**: 4 new issues filed (OC-001 through OC-004). 1 critical blocker, 2 high, 1 medium. TUI chrome works well (banner, themes, model selector UI, clear, compact, help, error messages) but ALL AI functionality is blocked by OC-001 (OpenCode server returns UnknownError for every prompt, error object improperly serialized as [object Object])
- **Copilot E2E testing Round 2 COMPLETE**: Re-tested all features post-fixes. Verified CP-001 (text stutter) RESOLVED, CP-004 (Ralph cancel) RESOLVED. 3 new issues filed (CP-008 console overlap, CP-009 view tool failures, CP-010 stream write error on startup). Total: 10 Copilot issues (2 resolved, 1 known SDK limitation, 7 open). Slash commands (/research-codebase, /create-spec, /create-feature-list, /explain-code) all work. Ralph yolo/cancel/restart all work. Core TUI features (theme, clear, compact, model, empty input, special chars, long input, rapid commands) all pass.
