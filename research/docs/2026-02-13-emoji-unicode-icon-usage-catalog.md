---
date: 2026-02-13 02:43:09 UTC
researcher: Copilot
git_commit: af01dd276fd02a8a3985334add8d5ac6895f5039
branch: lavaman131/hotfix/tool-ui
repository: atomic
topic: "Catalog of all emoji and Unicode icon usage across the codebase with migration mapping to terminal-safe icon set"
tags: [research, codebase, emoji, unicode, icons, tui, ui, tool-registry, status-indicators]
status: complete
last_updated: 2026-02-13
last_updated_by: Copilot
---

# Research: Emoji & Unicode Icon Usage Catalog

## Research Question

Catalog all emoji and Unicode icon usage across the codebase — including source files, tests, documentation, and configuration — identifying each emoji's semantic purpose (e.g., status indicator, log level, UI decoration, spinner). Then map each discovered emoji to its closest equivalent from the provided terminal-safe Unicode icon set.

## Summary

The Atomic codebase uses **zero traditional emoji** (e.g., 🔥, ✅, 🚀) in source code. Instead, it relies on ~40+ distinct **Unicode symbols** (geometric shapes, braille characters, box-drawing, mathematical symbols) for all terminal UI rendering. All icon usage is concentrated in `src/ui/` — no emoji or icons exist in `src/utils/`, `src/telemetry/`, `src/sdk/`, `src/commands/`, `src/models/`, `src/graph/`, `src/config/`, or shell scripts.

The icon architecture uses:
- **4 exported status icon constant objects** (same vocabulary: ○/●/✕ across components)
- **1 tool renderer registry** with per-tool icon properties (`src/ui/tools/registry.ts`)
- **1 shared animation component** (`AnimatedBlinkIndicator`) reused by 4+ components
- **Remaining symbols hardcoded inline** at point-of-use (no centralized icon module)

Tests and documentation use emoji for test data (🌍, 👋, 🎉) and feature status markers (✅, ❌, ⚠️), which are documentation-only and not rendered in the application.

---

## Detailed Findings

### 1. Status Indicators (Circles & Marks)

These are the most pervasive icons, defined as `Record<Status, string>` constants in 4+ components.

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | Files |
|---|---|---|---|---|
| `●` | U+25CF | Active/running/completed/enabled | `●` (U+25CF) — **keep as-is** | tool-result.tsx:42, parallel-agents-tree.tsx:82, task-list-indicator.tsx:47, mcp-server-list.tsx:56, skill-load-indicator.tsx:45, context-info-display.tsx:93, animated-blink-indicator.tsx:31, chat.tsx:972 |
| `○` | U+25CB | Pending/inactive/disabled | `○` (U+25CB) — **keep as-is** | tool-result.tsx:41, parallel-agents-tree.tsx:81, task-list-indicator.tsx:46, mcp-server-list.tsx:56 |
| `◌` | U+25CC | Background/detached process | `◌` (U+25CC) — **keep as-is** | parallel-agents-tree.tsx:85 |
| `◉` | U+25C9 | In-progress task / Sub-agent tool icon | `◉` (U+25C9) — **keep as-is** | tools/registry.ts:669, tools/registry.ts:732 |
| `✕` | U+2715 | Error/failure | `✗` (U+2717) Ballot X or `✘` (U+2718) Heavy Ballot X | tool-result.tsx:45, task-list-indicator.tsx:50, skill-load-indicator.tsx:45, transcript-formatter.ts:136 |
| `✓` | U+2713 | Success/completion | `✓` (U+2713) — **keep as-is** (already in set) | tools/registry.ts:314,732, user-question-dialog.tsx:385 |
| `·` | U+00B7 | Blink "off" state / text separator | `·` — **keep as-is** (standard separator) | animated-blink-indicator.tsx:31, chat.tsx:972, multiple files as separator |

**Constant Definition Locations:**

```
src/ui/components/tool-result.tsx:41-47         → STATUS_ICONS
src/ui/components/parallel-agents-tree.tsx:80-87 → STATUS_ICONS
src/ui/components/task-list-indicator.tsx:46-51  → TASK_STATUS_ICONS
src/ui/components/mcp-server-list.tsx:56         → inline ternary
src/ui/components/skill-load-indicator.tsx:45    → inline ternary
```

---

### 2. Tool Type Icons (Registry Pattern)

Defined as `icon` property on each `ToolRenderer` object in `src/ui/tools/registry.ts`.

| Current Icon | Codepoint | Tool Name | Proposed Replacement | Line |
|---|---|---|---|---|
| `≡` | U+2261 | Read | `≡` (U+2261) — **keep as-is** (already in set: "Menu / hamburger") | :64 |
| `△` | U+25B3 | Edit | `△` — **keep as-is** (not in set but unique) | :167 |
| `$` | U+0024 | Bash | `$` (U+0024) — **keep as-is** (already in set: "Classic bash prompt") | :221 |
| `►` | U+25BA | Write | `►` (U+25BA) — **keep as-is** (already in set: "Execute variant") | :292 |
| `◆` | U+25C6 | Glob | `◆` (U+25C6) — **keep as-is** (already in set: "Debug") | :348 |
| `★` | U+2605 | Grep | `★` (U+2605) — **keep as-is** (already in set: "Important / highlight") | :436 |
| `▶` | U+25B6 | Default | `▶` (U+25B6) — **keep as-is** (already in set: "Execute / run") | :499 |
| `§` | U+00A7 | MCP | `§` (U+00A7) — **keep as-is** (already in set: "Section / module") | :560 |
| `◉` | U+25C9 | Task/Sub-agent | `◉` (U+25C9) — **keep as-is** (already in set: "Selected radio") | :669 |
| `☑` | U+2611 | TodoWrite | `✔` (U+2714) Heavy Check Mark or keep `☑` | :719 |

---

### 3. Spinner & Loading Animations

| Current Icon(s) | Codepoint(s) | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷` | U+28FE, U+28FD, U+28FB, U+28BF, U+287F, U+28DF, U+28EF, U+28F7 | 8-frame braille spinner | **Keep as-is** — already matches "Spinner alt 1-8" in target set exactly | chat.tsx:806 |
| `⣿` | U+28FF | Completion indicator (full braille block) | **Keep as-is** — full braille (not in target set but consistent with spinner family) | chat.tsx:898 |

---

### 4. Tree Structure & Box Drawing

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `├─` | U+251C + U+2500 | Tree branch connector | `├─` — **keep as-is** (in target set: "T-junction right" + "Horizontal rule") | parallel-agents-tree.tsx:118 |
| `└─` | U+2514 + U+2500 | Last tree branch | `└─` — **keep as-is** (in target set: "Bottom-left corner") | parallel-agents-tree.tsx:119 |
| `│` | U+2502 | Vertical tree line | `│` — **keep as-is** (in target set: "Vertical separator") | parallel-agents-tree.tsx:120 |
| `⎿` | U+23BF | Sub-status connector | Consider `╰` (U+2570) "Rounded bottom-left" or `└` (U+2514) from target set | chat.tsx:1300,1343, parallel-agents-tree.tsx:287+, task-list-indicator.tsx:95, transcript-formatter.ts:90,189 |
| `─` (repeated) | U+2500 | Horizontal separator/divider | `─` — **keep as-is** (in target set) | model-selector-dialog.tsx:482, chat.tsx:4706, transcript-formatter.ts:225 |
| `╭─` | U+256D + U+2500 | Rounded dialog top-left | `╭` — **keep as-is** (in target set: "Rounded top-left") | user-question-dialog.tsx:300 |
| `─╮` | U+2500 + U+256E | Rounded dialog top-right | `╮` — **keep as-is** (in target set: "Rounded top-right") | user-question-dialog.tsx:302 |
| `└` | U+2514 | Skill load tree connector | `└` — **keep as-is** (in target set) | skill-load-indicator.tsx:74 |

---

### 5. Arrows & Flow Indicators

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `→` | U+2192 | File operation arrow (e.g., "→ config.ts") | `→` — **keep as-is** (in target set: "Flow / next step") | tool-result.tsx:209,215, transcript-formatter.ts |
| `↓` | U+2193 | Token count output indicator | `↓` — **keep as-is** (in target set: "Download / down") | chat.tsx:872,935 |
| `↑` | U+2191 | Keyboard hint (scroll up) | `↑` — **keep as-is** (in target set: "Upload / up") | chat.tsx:1796, user-question-dialog.tsx:405, model-selector-dialog.tsx:343 |

---

### 6. Prompt & Selection Indicators

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `❯` | U+276F | User input prompt / selection cursor | `❯` — **keep as-is** (in target set: "Shell prompt") | chat.tsx:1285,1327,4847, queue-indicator.tsx:109,129,151, model-selector-dialog.tsx:306,410, user-question-dialog.tsx:323,380, transcript-formatter.ts:84 |
| `›` | U+203A | Edit mode prefix (lighter chevron) | Consider `❮` (U+276E) or keep `›` (not in target set but standard) | queue-indicator.tsx:151 |

---

### 7. Progress Bar Characters

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `█` | U+2588 | Filled progress bar segment / scrollbar thumb | **Keep as-is** (standard block element) | context-info-display.tsx:76, chat.tsx:4880 |
| `░` | U+2591 | Empty progress bar segment | **Keep as-is** (standard block element) | context-info-display.tsx:77 |

---

### 8. Checkbox & Task Symbols

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `☐` | U+2610 | Unchecked markdown checkbox | **Keep as-is** or use `○` (U+25CB) from target set | chat.tsx:1262 |
| `☑` | U+2611 | Checked markdown checkbox / todo icon | `✔` (U+2714) from target set or **keep as-is** | chat.tsx:1263, tools/registry.ts:719, chat.tsx:4772 |
| `□` | U+25A1 | Pending task (empty square) | `○` (U+25CB) from target set (matches pending convention) | tools/registry.ts:732 |

---

### 9. Warning, Thinking & Log Level Symbols

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `⚠` | U+26A0 | Warning/system message prefix | `⚠` — **keep as-is** (in target set: "Warning Sign") | transcript-formatter.ts:208 |
| `∴` | U+2234 | Thinking/reasoning header | `∴` — **keep as-is** (in target set: "Therefore / Conclusion / result") | transcript-formatter.ts:99 |
| `…` | U+2026 | Text truncation / loading | `…` — **keep as-is** (in target set: "Loading / thinking") | chat.tsx:882,1278 |

---

### 10. Miscellaneous UI Symbols

| Current Icon | Codepoint | Semantic Purpose | Proposed Replacement | File:Line |
|---|---|---|---|---|
| `⋮` | U+22EE | Queue indicator icon (more options) | `⋮` — **keep as-is** (in target set: "More options") | queue-indicator.tsx:60 |
| `▾` | U+25BE | Collapsed content indicator | Consider `↓` (U+2193) from target set or **keep as-is** | tool-result.tsx:150 |
| `□` | U+25A1 | Dialog header icon | Consider `◆` (U+25C6) or `■` or **keep as-is** | user-question-dialog.tsx:301 |

---

### 11. Banner / ASCII Art (Block Characters)

**File:** `src/utils/banner/constants.ts:12-44` and `src/ui/chat.tsx:274-280`

Uses extensive block-drawing characters for the "ATOMIC" logo:
- `█ ▀ ▄ ▌ ▐ ░ ▒ ▓` — Full blocks, half blocks, shade characters
- These are **decorative branding** with true-color ANSI escape sequences
- **Recommendation**: These are outside the scope of the icon replacement since they form bitmap art, not semantic icons

---

### 12. Mermaid Diagram Template Icons

**File:** `src/ui/commands/skill-commands.ts:377-390`

Contains `◉`, `◆`, `●` inside Mermaid diagram template strings for system design prompt examples. These are part of a documentation/example prompt, not UI rendering.

---

### 13. Test File Emoji (Not Application UI)

Found in 7 test files — these are **test data**, not application icons:

| Emoji | File | Purpose |
|---|---|---|
| `→` | tests/ui/chat-autocomplete.test.ts:144,180,195 | Test descriptions (state transitions) |
| `→` | tests/ui/chat-command-execution.test.ts:433 | Test description (execution flow) |
| `🌍 👋 🎉` | tests/ui/chat.test.ts:416,922, tests/ui/hooks/use-message-queue.test.ts:535, tests/ui/components/queue-indicator.test.tsx:275 | Unicode content handling tests |
| `✓ ○ ● ◐ ✗ ►` | tests/ui/components/tool-result.test.tsx:171,194-203,330,513,526 | Testing UI icon rendering |
| `✓ ○ ►` | tests/ui/tools/registry.test.ts:332,350,360 | Testing tool renderer icons |

---

### 14. Documentation-Only Emoji (Not Application UI)

Found extensively in `research/` and `specs/` directories:

| Emoji | Purpose | Scope |
|---|---|---|
| `✅ ❌ ⚠️` | Feature status markers in research/spec docs | 130+ files |
| `📄 📝 💻 🔍 🔎 🌐 📋 📂 🔧 🔌 ✏️` | Tool icon references in specs | Historical references to old emoji-based tool icons |
| `🖌️` | Style guide decoration | docs/style-guide.md:2 |
| `⚡ ✦ ⚛️` | Category/branding in docs | research/docs/ |

**Note:** `specs/2026-02-12-bun-test-failures-remediation.md:240-245` documents a **previous migration** from emoji tool icons (📄, 💻, 📝, 🔍, 🔎, 🔧) to the current Unicode icons (≡, $, ►, ◆, ★, ▶). This confirms the codebase has already undergone one round of emoji-to-Unicode migration.

---

## Migration Mapping Summary

### Icons Already in Target Set (No Change Needed)

These icons are **already present** in the provided terminal-safe icon set:

| Icon | Codepoint | Current Use |
|---|---|---|
| `❯` | U+276F | Shell prompt / selection cursor |
| `▶` | U+25B6 | Default tool icon |
| `►` | U+25BA | Write tool icon |
| `$` | U+0024 | Bash tool icon |
| `✓` | U+2713 | Success indicator |
| `✗` | U+2717 | (Available as replacement for ✕) |
| `●` | U+25CF | Active/filled indicator |
| `○` | U+25CB | Inactive/empty indicator |
| `◉` | U+25C9 | Selected radio / sub-agent icon |
| `◌` | U+25CC | Background process indicator |
| `⚠` | U+26A0 | Warning sign |
| `◆` | U+25C6 | Glob tool icon |
| `★` | U+2605 | Grep tool icon |
| `≡` | U+2261 | Read tool icon |
| `§` | U+00A7 | MCP tool icon |
| `…` | U+2026 | Ellipsis / loading |
| `⋮` | U+22EE | Queue / more options |
| `∴` | U+2234 | Thinking / conclusion |
| `→` | U+2192 | Flow / file operations |
| `↑` | U+2191 | Up navigation |
| `↓` | U+2193 | Down / token output |
| `─` | U+2500 | Horizontal rule |
| `│` | U+2502 | Vertical separator |
| `├` | U+251C | T-junction right |
| `└` | U+2514 | Bottom-left corner |
| `╭` | U+256D | Rounded top-left |
| `╮` | U+256E | Rounded top-right |
| Braille spinner frames | U+28FE-U+28F7 | Spinner alt 1-8 |

### Icons Requiring Replacement (5 Changes)

| Current Icon | Codepoint | Proposed Replacement | Codepoint | Rationale |
|---|---|---|---|---|
| `✕` | U+2715 (Multiplication X) | `✗` | U+2717 (Ballot X) | Target set uses ✗ for "Failure" — same visual, correct semantic |
| `⎿` | U+23BF (Terminal graphic) | `╰` | U+2570 (Rounded bottom-left) | Target set includes ╰ — similar visual connector for sub-status lines |
| `☑` | U+2611 (Ballot Box w/ Check) | `✔` | U+2714 (Heavy Check Mark) | Target set "Success (bold)" — or keep ☑ for checkbox semantics |
| `☐` | U+2610 (Ballot Box) | `○` | U+25CB (White Circle) | Matches existing pending convention, or keep ☐ |
| `□` | U+25A1 (White Square) | `○` | U+25CB (White Circle) | Aligns pending state with existing ○ pattern |

### Icons Not in Target Set (Keep or Evaluate)

| Icon | Codepoint | Current Use | Recommendation |
|---|---|---|---|
| `△` | U+25B3 | Edit tool icon | Keep — unique identifier, no equivalent in set |
| `›` | U+203A | Edit mode prefix | Keep or replace with `❮` (U+276E) |
| `⣿` | U+28FF | Completion braille block | Keep — consistent with braille spinner family |
| `█` | U+2588 | Progress bar / scrollbar | Keep — standard block element |
| `░` | U+2591 | Empty progress bar | Keep — standard block element |
| `▾` | U+25BE | Collapsed content | Keep or replace with `↓` (U+2193) |
| `·` | U+00B7 | Middle dot separator | Keep — universal separator |
| Block art chars | Various | Banner/logo | Keep — decorative bitmap art |

---

## Code References

### Status Icon Constants
- `src/ui/components/tool-result.tsx:41-47` — `STATUS_ICONS` for tool execution
- `src/ui/components/parallel-agents-tree.tsx:80-87` — `STATUS_ICONS` for agent status
- `src/ui/components/task-list-indicator.tsx:46-51` — `TASK_STATUS_ICONS`
- `src/ui/components/mcp-server-list.tsx:56` — inline ternary (● / ○)
- `src/ui/components/skill-load-indicator.tsx:45` — inline ternary (● / ✕)
- `src/ui/utils/transcript-formatter.ts:136` — inline status selection

### Tool Registry Icons
- `src/ui/tools/registry.ts:64` — Read: `≡`
- `src/ui/tools/registry.ts:167` — Edit: `△`
- `src/ui/tools/registry.ts:221` — Bash: `$`
- `src/ui/tools/registry.ts:292` — Write: `►`
- `src/ui/tools/registry.ts:348` — Glob: `◆`
- `src/ui/tools/registry.ts:436` — Grep: `★`
- `src/ui/tools/registry.ts:499` — Default: `▶`
- `src/ui/tools/registry.ts:560` — MCP: `§`
- `src/ui/tools/registry.ts:669` — Task: `◉`
- `src/ui/tools/registry.ts:719` — TodoWrite: `☑`

### Spinner Animation
- `src/ui/chat.tsx:806` — `SPINNER_FRAMES` array (8 braille characters)
- `src/ui/chat.tsx:898` — `⣿` completion character
- `src/ui/components/animated-blink-indicator.tsx:31` — `●` / `·` alternation

### Prompt Indicators
- `src/ui/chat.tsx:1285,1327,4847` — `❯` user prompt
- `src/ui/components/queue-indicator.tsx:109,129,151` — `❯` / `›` prefix
- `src/ui/components/model-selector-dialog.tsx:306,410` — `❯` selection
- `src/ui/components/user-question-dialog.tsx:323,380` — `❯` highlight

### Tree / Box Drawing
- `src/ui/components/parallel-agents-tree.tsx:117-122` — `TREE_CHARS` constant
- `src/ui/chat.tsx:1300,1343` — `⎿` sub-status connector
- `src/ui/components/task-list-indicator.tsx:95` — `⎿` connector
- `src/ui/utils/transcript-formatter.ts:90,185-193` — `⎿`, `├─`, `│`
- `src/ui/components/skill-load-indicator.tsx:74` — `└` connector
- `src/ui/components/user-question-dialog.tsx:300-302` — `╭─` / `─╮` dialog border

### Progress / Visual
- `src/ui/components/context-info-display.tsx:76-77` — `█` / `░` progress bar
- `src/ui/chat.tsx:4880` — `█` / `│` scrollbar
- `src/ui/components/tool-result.tsx:150` — `▾` collapse indicator

### Arrows
- `src/ui/components/tool-result.tsx:209,215` — `→` file operations
- `src/ui/chat.tsx:872,935` — `↓` token count
- `src/ui/chat.tsx:1796` — `↑` keyboard hint
- `src/ui/components/user-question-dialog.tsx:405` — `↑/↓` navigation hint
- `src/ui/components/model-selector-dialog.tsx:343` — `↑↓` navigation hint

### Checkboxes / Todos
- `src/ui/chat.tsx:1262-1263` — `☐` / `☑` markdown checkbox conversion
- `src/ui/tools/registry.ts:732` — `✓` / `◉` / `□` todo status
- `src/ui/chat.tsx:4772` — `☑` todo panel summary

### Warning / Thinking
- `src/ui/utils/transcript-formatter.ts:208` — `⚠` warning prefix
- `src/ui/utils/transcript-formatter.ts:99` — `∴` thinking header
- `src/ui/chat.tsx:882,1278` — `…` ellipsis truncation

### Banner Art
- `src/utils/banner/constants.ts:12-44` — Block characters for logo
- `src/ui/chat.tsx:274-280` — `ATOMIC_BLOCK_LOGO`

---

## Architecture Documentation

### Icon Management Pattern

The codebase follows a **decentralized inline pattern** with partial constant extraction:

1. **Status icons**: Extracted to `Record<Status, string>` constants per component — consistent vocabulary (○/●/✕) but duplicated across 4+ files
2. **Tool icons**: Centralized in `src/ui/tools/registry.ts` as `ToolRenderer.icon` properties
3. **Tree characters**: Extracted to `TREE_CHARS` constant in parallel-agents-tree.tsx
4. **Spinner frames**: Extracted to `SPINNER_FRAMES` constant in chat.tsx
5. **All other icons**: Hardcoded inline at point of use

There is **no centralized icon module** or theme-based icon configuration. To replace icons globally, each occurrence must be individually located and updated.

### Animation System

- `AnimatedBlinkIndicator` (`src/ui/components/animated-blink-indicator.tsx`) — Shared React component
- Used by: ToolResult, TaskListIndicator, ParallelAgentsTree, SkillLoadIndicator
- Alternates between `●` and `·` at 500ms intervals
- Color is theme-aware (accent for running, success/error for completion)

### Previous Migration History

`specs/2026-02-12-bun-test-failures-remediation.md` documents that the codebase previously migrated **from emoji to Unicode**:
- `📄` → `≡` (Read)
- `💻` → `$` (Bash)
- `📝` → `►` (Write)
- `🔍` → `◆` (Glob)
- `🔎` → `★` (Grep)
- `🔧` → `▶` (Default)

This confirms the current icon set was a deliberate design choice away from multi-codepoint emoji.

---

## Historical Context (from research/)

- `research/docs/2026-02-12-sdk-ui-standardization-research.md` — Documents standardization of tool/task/sub-agent rendering across SDKs
- `research/docs/2026-02-12-sdk-ui-standardization-comprehensive.md` — Comprehensive SDK UI standardization modeling Claude Code design
- `research/docs/2026-02-12-bun-test-failures-root-cause-analysis.md` — Root cause analysis of 104 test failures, including tool renderer icon assertions
- `research/docs/2026-02-06-mcp-tool-calling-opentui.md` — MCP tool renderer registry with icon system
- `research/docs/2026-02-05-subagent-ui-opentui-independent-context.md` — Sub-agent UI with status icons and tree connectors
- `research/docs/2026-02-08-skill-loading-from-configs-and-ui.md` — Skill loading UI with ● and ✕ status icons
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` — Claude Code UI patterns (❯ prompt, ⎿ connector, status dots)

---

## Related Research

- `research/docs/2026-02-12-bun-test-failures-root-cause-analysis.md` — Previous emoji→Unicode migration context
- `research/docs/2026-02-12-sdk-ui-standardization-research.md` — UI standardization patterns
- `research/docs/2026-02-01-claude-code-ui-patterns-for-atomic.md` — Design inspiration for current icon choices

---

## Open Questions

1. **Centralized icon module**: Should a `src/ui/constants/icons.ts` be created to centralize all icon definitions, eliminating duplication across 4+ status icon constant objects?
2. **⎿ connector replacement**: The `⎿` (U+23BF) character is used extensively for sub-status lines. Replacing it with `╰` (U+2570) would change the visual alignment — needs visual testing in terminal.
3. **Checkbox symbols**: Should `☐`/`☑` be replaced with `○`/`✔` from the target set, or kept for their stronger checkbox semantics in markdown rendering?
4. **Test assertions**: Several test files assert specific icon values (e.g., `expect(renderer.icon).toBe("►")`). Any icon changes will require corresponding test updates.
5. **Banner art**: The `ATOMIC_BLOCK_LOGO` uses block characters outside the target set — should these be considered in scope?
