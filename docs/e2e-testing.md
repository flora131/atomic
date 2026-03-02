# E2E Testing Guide

> **Purpose:** End-to-end testing of the Atomic TUI across all three agents (claude, opencode, copilot). The test scenario builds a **snake game in Rust from scratch**, exercising every user-facing feature: slash commands, keyboard shortcuts, tool calls, MCP, message queuing, model selection, themes, session management, skills, agents, workflows, and HITL dialogs.

Tip: This guide is window-based. In `REMOTE` mode, `tmux-cli launch` creates a new window; in `LOCAL` mode, use `tmux new-window` and target the returned `session:window.pane` with `tmux-cli`.

---

## Prerequisites

1. **Verify the Atomic project builds and tests pass:**

    ```bash
    bun install && bun typecheck && bun lint && bun test
    ```

    If any fail, fix them before proceeding.

2. **Set environment variables:**

These env vars come from the parent session, not the `tmux-cli` session:

    ```bash
    export ATOMIC_PROJECT_DIR=$PWD
    ```

3. **Create a screenshots directory:**

    ```bash
    mkdir -p $ATOMIC_PROJECT_DIR/tmux-screenshots
    ```

4. **Ensure `tmux-cli` is available:**

    ```bash
    tmux-cli help
    ```

5. **Confirm tmux mode and launch method (window-based):**

    ```bash
    tmux-cli help | rg "MODE:"
    ```

    - If it prints `MODE: REMOTE ...`, create windows with:

        ```bash
        tmux-cli launch "zsh"
        ```

    - If it prints `MODE: LOCAL ...`, create windows with:

        ```bash
        tmux new-window -P -F '#S:#I.0' -n atomic-e2e "zsh"
        ```

        Use the returned pane target (for example, `dev:3.0`) as `WINDOW_ID` for all `tmux-cli send/capture/wait_idle/kill` commands.

6. **Initialize atomic-e2e project directory:**

    ```bash
    mkdir -p /tmp/snake_game/claude
    mkdir -p /tmp/snake_game/opencode
    mkdir -p /tmp/snake_game/copilot
    ```

    Note: when you first run the TUI, it will prompt you for configuration. Use `GitHub / Git` as the source control system and confirm with `Yes` to configure in the agent's directory (e.g., `/tmp/snake_game/claude`). This is required to enable source control tool calls that the agents rely on for file editing and creation. You only need to do this once per agent; the configuration will be saved for future runs in the same local folder:

    ```
    ┌  Atomic: Automated Procedures and Memory for AI Coding Agents
    │
    │  Enable multi-hour autonomous coding sessions with the Ralph Wiggum
    │  Method using research, plan, implement methodology.
    │
    ●  Source control skills are not configured for Claude. Starting interactive setup...
    │
    ●  Configuring Claude Code...
    │
    ◇  Select your source control system:
    │  GitHub / Git
    │
    ◇  Configure Claude Code source control skills in /tmp/snake_game/claude?
    │  Yes
    ```

---

## Testing Protocol

### How to Drive the TUI via `tmux-cli`

Every test MUST be executed in a dedicated tmux window. Follow this protocol for every interaction:

1. **Launch a shell window** (always launch a shell first to avoid losing output):

    ```bash
    # REMOTE mode:
    tmux-cli launch "zsh"
    # OR LOCAL mode:
    tmux new-window -P -F '#S:#I.0' -n atomic-e2e "zsh"
    # Save the returned target (e.g., "remote-cli-session:2.0" or "dev:3.0") as WINDOW_ID
    ```

2. **Start Atomic inside that window:**

    ```bash
    tmux-cli send "cd /tmp/snake_game/<AGENT> && bun run $ATOMIC_PROJECT_DIR/src/cli.ts chat -a <AGENT>" --pane=<WINDOW_ID>
    ```

    Replace `<AGENT>` with `claude`, `opencode`, or `copilot`.

3. **Send commands to the TUI:**

    ```bash
    tmux-cli send "<YOUR COMMAND HERE>" --pane=<WINDOW_ID>
    ```

4. **Wait for operations to complete** before capturing:

    ```bash
    tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
    ```

5. **Capture TUI state after EVERY significant action:**

    ```bash
    tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-<STEP>-<DESCRIPTION>.txt
    ```

6. **Check window status at any time:**

    ```bash
    tmux-cli status
    tmux-cli list_windows
    ```

7. **Kill the window when done:**

    ```bash
    tmux-cli kill --pane=<WINDOW_ID>
    ```

### Continuous Screenshot Polling

**IMPORTANT:** Some UI events (spinners, status transitions, loading indicators) are transient and can be missed with a single capture. To catch these, use continuous polling that captures every 2 seconds during every test step.

Define these helper functions at the start of your session:

```bash
# Start background polling — captures every 2 seconds
start_polling() {
  local window_id=$1 agent=$2 step=$3
  (
    local i=0
    while true; do
      tmux-cli capture --pane=$window_id > $ATOMIC_PROJECT_DIR/tmux-screenshots/${agent}-${step}-poll-${i}.txt 2>/dev/null
      i=$((i + 1))
      sleep 2
    done
  ) &
  echo $!
}

# Stop background polling
stop_polling() {
  kill $1 2>/dev/null
  wait $1 2>/dev/null
}
```

**Usage pattern for every test step:**

```bash
# 1. Start polling BEFORE sending the command
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> <STEP>)

# 2. Send the command
tmux-cli send "<YOUR COMMAND>" --pane=<WINDOW_ID>

# 3. Wait for completion
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0

# 4. Stop polling
stop_polling $POLL_PID

# 5. Take a final definitive capture
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-<STEP>-final.txt
```

The polling captures transient UI states (tool status transitions, spinner animations, loading indicators) while the final capture records the end state.

### `tmux-cli` Command Reference

| Command                                            | Description                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tmux-cli launch "[cmd]"`                          | Launches in a new window when `MODE: REMOTE`. **Always launch `zsh` first.**                    |
| `tmux new-window -P -F '#S:#I.0' -n name "[cmd]"`  | Creates a new window when `MODE: LOCAL`; use the returned `session:window.pane` as `WINDOW_ID`. |
| `tmux-cli send "text" --pane=ID`                   | Send text + Enter to a window's main pane                                                       |
| `tmux-cli send "text" --pane=ID --enter=False`     | Send text without pressing Enter                                                                |
| `tmux-cli send "text" --pane=ID --delay-enter=0.5` | Custom delay before Enter (seconds)                                                             |
| `tmux-cli capture --pane=ID`                       | Capture output from a window's main pane                                                        |
| `tmux-cli wait_idle --pane=ID --idle-time=3.0`     | Wait until output is idle for N seconds                                                         |
| `tmux-cli status`                                  | Show current tmux location and targets                                                          |
| `tmux-cli list_windows`                            | List windows in the managed remote session                                                      |
| `tmux-cli kill --pane=ID`                          | Kill a window by targeting its `WINDOW_ID`                                                      |
| `tmux-cli help`                                    | Show full help documentation                                                                    |

### When You Find a Bug

If at ANY point during testing you observe a bug, you MUST:

1. **Stop testing immediately.**
2. **Capture evidence:**
    ```bash
    tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/BUG-<description>.txt
    ```
3. **Identify the root cause** in the Atomic source code.
4. **Fix the bug** directly in the source code.
5. **Verify the fix:**
    - Run `bun typecheck && bun lint && bun test` — all must pass.
    - Re-run the specific test scenario and capture a new snapshot showing it's fixed.
6. **Commit the fix:**
    ```bash
    git add <specific-files-changed>
    git commit -m "fix(<component>): <concise description>"
    ```
7. **Resume testing from where you left off.**

Do NOT skip bugs. Do NOT proceed to the next phase until all bugs are fixed.

---

## Test Scenario: Building a Snake Game in Rust

The test builds a terminal-based snake game from scratch using Rust + crossterm. This exercises real tool calls (cargo, file creation, compilation), multi-turn conversation, and all TUI features.

Run this entire sequence for **each agent** (`claude`, `opencode`, `copilot`). Replace `<AGENT>` throughout.

### Phase 1: Setup & Launch

```bash
# 1. Create the project directory
mkdir -p /tmp/snake_game/<AGENT>

# 2. Launch a shell window
# REMOTE mode:
tmux-cli launch "zsh"
# OR LOCAL mode:
tmux new-window -P -F '#S:#I.0' -n atomic-e2e "zsh"
# Save the returned window target as WINDOW_ID

# 3. Start polling to catch startup UI events
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 01-launch)

# 4. Start Atomic with the agent
tmux-cli send "cd /tmp/snake_game/<AGENT> && bun run $ATOMIC_PROJECT_DIR/src/cli.ts chat -a <AGENT>" --pane=<WINDOW_ID>

# 5. Wait for the TUI to fully render
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=5.0

# 6. Stop polling and take final capture
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-01-launch-final.txt
```

**Verify:** TUI renders with the input prompt, footer shows agent name and model.

### Phase 2: Built-in Commands

Test every built-in slash command before starting the coding task.

#### 2.1 — `/help`

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 02-help)
tmux-cli send "/help" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-02-help-final.txt
```

**Verify:** All command categories listed — Slash Commands, Skills, Sub-Agents, Workflows.

#### 2.2 — `/theme`

```bash
# Switch to light theme
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 03-theme-light)
tmux-cli send "/theme light" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=2.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-03-theme-light-final.txt

# Switch back to dark theme
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 04-theme-dark)
tmux-cli send "/theme dark" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=2.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-04-theme-dark-final.txt
```

**Verify:** Colors change visibly between captures. Footer and messages reflect the active theme.

#### 2.3 — `/model`

```bash
# List available models
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 05-model-list)
tmux-cli send "/model list" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-05-model-list-final.txt

# Open interactive model selector
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 06-model-selector)
tmux-cli send "/model select" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=2.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-06-model-selector-final.txt

# Dismiss the selector with ESC
tmux-cli send "" --pane=<WINDOW_ID> --enter=False
# Send ESC key sequence
tmux-cli send $'\x1b' --pane=<WINDOW_ID> --enter=False
```

**Verify:** Model list shows providers and context window sizes. Selector dialog appears with keyboard navigation hints.

#### 2.4 — `/mcp`

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 07-mcp)
tmux-cli send "/mcp" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-07-mcp-final.txt
```

**Verify:** MCP servers listed with enabled/disabled status and tool counts.

### Phase 3: Building the Snake Game (Tool Calls)

These prompts generate real tool calls — bash commands, file creation, file edits — that you must verify render correctly in the TUI.

#### 3.1 — Initialize Rust Project

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 08-cargo-init)
tmux-cli send "Initialize a new Rust project here with cargo init. Add crossterm and rand as dependencies in Cargo.toml for terminal rendering and random food placement." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-08-cargo-init-final.txt
```

**Verify:**

- Tool call status indicators appear: `○` (pending) → `●` blinking (running) → `●` green (completed)
- Bash tool calls show the commands executed (`cargo init`, editing `Cargo.toml`)
- File creation/edit tools show paths and content with syntax highlighting

#### 3.2 — Create Game Logic (Multi-turn + Tool Calls)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 09-game-logic)
tmux-cli send "Now create the snake game in src/main.rs. Requirements: 1) 20x20 grid rendered with crossterm, 2) Snake moves with WASD keys, 3) Food spawns randomly, 4) Score displayed at top, 5) Game over on wall or self collision. Make it a complete, runnable game." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=30.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-09-game-logic-final.txt
```

**Verify:**

- Multiple tool calls execute (file edits, possibly bash for cargo check)
- Edit tool shows file path and diff coloring (green for additions)
- Streaming metadata visible: elapsed time, token count, spinner animation
- On completion: summary line shows total time + tokens

#### 3.3 — Message Queuing (Cmd/Ctrl+Shift+Enter)

While the agent is still streaming from the previous step (or send a new long prompt), test message queuing. The queue enqueue shortcut is **Cmd+Shift+Enter** on macOS and **Ctrl+Shift+Enter** on Linux/Windows.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 10-message-queue)

# Send a prompt that will trigger a long response
tmux-cli send "Add a high score system that persists to a file called highscores.txt, and add a pause feature with the P key." --pane=<WINDOW_ID>

# Wait for streaming to start, then type a follow-up and enqueue it
# Ctrl+Shift+Enter escape sequence: \x1b[13;6u (Linux/Windows)
# Cmd+Shift+Enter escape sequence: \x1b[13;10u (macOS)
sleep 2
tmux-cli send "Also add a speed increase every 5 points to make the game progressively harder." --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli send $'\x1b[13;6u' --pane=<WINDOW_ID> --enter=False

# Capture while streaming to verify queue indicator
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-10-message-queue-during-stream.txt

# Queue a second message
tmux-cli send "And add a game-over animation when the snake dies." --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli send $'\x1b[13;6u' --pane=<WINDOW_ID> --enter=False

tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-10-message-queue-final.txt
```

**Verify:**

- **Queue indicator** appears above the chatbox showing queue icon, count text ("1 message queued" / "2 messages queued"), and a preview of the first queued message
- **Footer during streaming** shows: `esc to interrupt · ctrl+shift+enter enqueue`
- **Chatbox placeholder** changes to `"Type a message (enter to interrupt, ctrl+shift+enter to enqueue)..."` while streaming
- **Auto-dispatch**: After the first response completes, the next queued message is automatically dispatched (50ms delay) without user intervention
- **Sequential processing**: All queued messages process one-by-one in FIFO order

#### 3.3.1 — Queue Editing (Up/Down Arrows)

After queuing messages, test editing them before they dispatch:

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 10b-queue-edit)

# Send a long prompt to start streaming
tmux-cli send "Write unit tests for every function in the snake game module." --pane=<WINDOW_ID>
sleep 2

# Queue two messages
tmux-cli send "Fix any compilation warnings." --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli send $'\x1b[13;6u' --pane=<WINDOW_ID> --enter=False
tmux-cli send "Run cargo clippy." --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli send $'\x1b[13;6u' --pane=<WINDOW_ID> --enter=False

# Wait for streaming to complete so we can edit the queue
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0

# Press Up arrow to enter queue edit mode (loads last queued message into textarea)
tmux-cli send $'\x1b[A' --pane=<WINDOW_ID> --enter=False
sleep 1
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-10b-queue-edit-last.txt

# Press Up again to navigate to the previous queued message
tmux-cli send $'\x1b[A' --pane=<WINDOW_ID> --enter=False
sleep 1
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-10b-queue-edit-first.txt

# Press Down past last message to exit edit mode
tmux-cli send $'\x1b[B\x1b[B' --pane=<WINDOW_ID> --enter=False
sleep 1

tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-10b-queue-edit-final.txt
```

**Verify:**

- **Up arrow** with queued messages enters edit mode — last queued message content loads into textarea
- **Queue indicator expands** to non-compact mode: shows numbered list of queued messages, currently editing message highlighted with `›` prefix and accent color
- **Up/Down arrows** navigate between queued messages, auto-saving edits on navigation
- **Down past last message** exits edit mode and clears the textarea
- **Placeholder** shows `"Press ↑ to edit queued messages..."` when queue is non-empty and not streaming

#### 3.4 — Build & Compile (Bash Tool Verification)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 11-cargo-build)
tmux-cli send "Run cargo build and fix any compilation errors." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=20.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-11-cargo-build-final.txt
```

**Verify:**

- Bash tool call shows `cargo build` command and output
- If errors occur, agent iterates to fix them (multi-turn tool usage)
- Tool status transitions through pending → running → completed/error

### Phase 4: Session Management

#### 4.1 — Session History Scrolling

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 12-scroll)

# Scroll up through messages with Up arrow
tmux-cli send "" --pane=<WINDOW_ID> --enter=False
# Send multiple Up arrows to scroll
tmux-cli send $'\x1b[A\x1b[A\x1b[A\x1b[A\x1b[A' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-12-scroll-up-final.txt

# Scroll down back to latest
tmux-cli send $'\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-13-scroll-down-final.txt

# PageUp for half-screen scroll
tmux-cli send $'\x1b[5~' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-14-pageup-final.txt

# PageDown back
tmux-cli send $'\x1b[6~' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-15-pagedown-final.txt

stop_polling $POLL_PID
```

**Verify:** Visible message content changes when scrolling. Auto-scroll returns to bottom.

#### 4.2 — Transcript Mode (Ctrl+O)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 16-transcript)

# Toggle verbose transcript mode
tmux-cli send $'\x0f' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-16-verbose-mode-final.txt

# Toggle back to compact mode
tmux-cli send $'\x0f' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-17-compact-mode-final.txt

stop_polling $POLL_PID
```

**Verify:** Footer toggles between "verbose" and "compact". Message rendering changes accordingly.

#### 4.3 — `/compact`

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 18-compact)
tmux-cli send "/compact" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-18-compact-final.txt
```

**Verify:** Context compaction summary appears. Token usage reduced. Session continues working.

### Phase 5: Agent & Skill Invocation

#### 5.1 — Foreground Sub-Agent Invocation (`@agent`)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 19-agent-debugger)
tmux-cli send "@debugger Check if the snake game compiles. Run cargo check and report any issues." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-19-agent-debugger-final.txt
```

Spawn parallel sub-agents as well:

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 20-parallel-agents)
tmux-cli send "@debugger run cargo check and fix any issues. @reviewer run cargo test and report results." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=30.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-20-parallel-agents-final.txt
```

**Verify:**

- Agent part renders with agent name and status
- Parallel agent tree shows live status updates (pending → running → completed)
- Sub-agent state displayed inline in sub-agent tree:
    - Tools and tool counts are streamed in the single agent case
    - Tools and tool counts are streamed in ALL branches of parallel agent case
- The parallel agent tree should look roughly like this during initialization:

**Foreground Sub-agent Invocation**

1. During initialization (no tool calls or streaming started)

    ```
    ● Running 2 agents…
    ├─● Locate sub-agent message handling
    │    ╰  Initializing codebase-locator… (2s)
    └─● Find sub-agent text rendering code
         ╰  Initializing codebase-pattern-finder… (5s)
    ```

2. During execution (tools and tool counts stream for each branch):

    Here's how a correct UI looks during execution:

    ```
    ● Running 2 agents…
    ├─● Locate sub-agent message handling
    │    ╰ codebase-locator: (10 tool uses)
    │      · rg
    └─● Find sub-agent text rendering code
         ╰ codebase-pattern-finder: (5 tool uses)
           · ls
    ```

    Here's how an incorrect UI looks:

    ```
    ● Running 2 codebase-analyzer agents…
    ├─● codebase-analyzer
    · 39 tool uses
    │    ╰  bash (2m 22s)
    └─● codebase-analyzer
    · 35 tool uses
        ╰  view (2m 22s)
    ```

#### 5.1.1 — Background Sub-Agent Invocation

Similar procedure for background agents, but verify the sub-agent tree renders **without** tool counts or streaming metadata:

**Background Sub-agent Invocation**

1. During initialization (no tool calls or streaming started)

```
● 2 Task agents launched…
├─● Locate OpenCode SDK integration
│    ╰  Running codebase-locator in background…
└─● Analyze SDK tool display patterns
      ╰  Running codebase-analyzer in background…
```

Background agent progress is shown via the footer status text below the chatbox:

```

[CHATBOX]
[N] local agents · ctrl+f to kill all background tasks

```

When the chatbox is streaming AND background agents are running, the footer combines both:

```

[CHATBOX]
esc to interrupt · ctrl+shift+enter enqueue · [N] local agents · ctrl+f to kill all background tasks

```

2. During execution: N/A, under the chatbox ui contains status and should be updated

3. Finished state:

```
● Agent "Explore Claude adapter for comparison" completed

● Agent [TASK_DESCRIPTION] completed
```

#### 5.2 — Skill Invocation (`/research-codebase`)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 20-research-skill)
tmux-cli send '/research-codebase "Analyze the snake game architecture and document the module structure"' --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=30.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-20-research-skill-final.txt
```

**Verify:**

- Skill loading indicator appears
- Research agents spawn (parallel agent tree visible)
- Output documents created in `research/` directory

### Phase 6: HITL / Ask-Question Dialog

The `ask_question` tool renders an **inline dialog** within the chat scrollbox (not a modal overlay). When the dialog is active, the chatbox textarea is hidden and replaced by the dialog.

#### 6.1 — Basic ask_question

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 21-ask-question)
tmux-cli send "I want to refactor the game. Should I split it into multiple files (game.rs, snake.rs, food.rs, renderer.rs) or keep it in a single file? Ask me which approach I prefer before proceeding." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-21-ask-question-final.txt
```

If the ask_question dialog appears:

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 22-ask-answer)
# Select an option with a number key (1-9 for model-provided options)
tmux-cli send "1" --pane=<WINDOW_ID> --enter=False
sleep 1
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22-ask-question-selected.txt

# Wait for agent to continue with the selected choice
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22-ask-question-answered-final.txt
```

**Verify:**

- Dialog renders **inline** within the chat scrollbox with a header badge, question text, and numbered options
- The chatbox textarea is **hidden** while the dialog is active
- Number keys (1-9) directly select and submit a model-provided option (single-select mode)
- Up/Down arrows navigate the option list with a highlighted cursor
- Footer hint line shows: `Enter to select · ↑/↓ to navigate · Esc to cancel`
- After answering, the HITL response is rendered inline with the tool call, and the agent continues

#### 6.2 — ask_question Custom Input ("Type something" / "Chat about this")

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 22b-ask-custom-input)
tmux-cli send "What color should the snake be? Ask me before changing anything." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0

# Navigate to the "Type something." option (last model option + 1)
# Use Down arrow to reach it, then Enter to activate custom input mode
tmux-cli send $'\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B' --pane=<WINDOW_ID> --enter=False
sleep 0.5
# Press Enter to activate custom input textarea
tmux-cli send "" --pane=<WINDOW_ID>
sleep 1
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22b-custom-input-active.txt

# Type custom text and submit
tmux-cli send "Bright green with a darker green tail" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22b-custom-input-final.txt
```

**Verify:**

- Every dialog includes two special options at the bottom: **"Type something."** and **"Chat about this"**
- Selecting "Type something." opens a textarea within the dialog for freeform input
- Selecting "Chat about this" also opens a textarea (with a different placeholder)
- Pressing ESC while in the custom input textarea **exits the textarea back to the option list** (does not dismiss the dialog)
- A second ESC press from the option list **dismisses the entire dialog**

#### 6.3 — ask_question Dismissal with ESC

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 22c-ask-esc-dismiss)
tmux-cli send "Ask me what difficulty level I want for the snake game before making any changes." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22c-ask-esc-dialog.txt

# Dismiss the dialog with ESC
tmux-cli send $'\x1b' --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=5.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22c-ask-esc-dismissed-final.txt
```

**Verify:**

- ESC sends a **cancellation response** (`cancelled: true`, `responseMode: "declined"`) — not an empty string
- The agent receives the cancellation and either stops or adjusts its behavior
- The chatbox textarea **reappears** after the dialog is dismissed
- The HITL tool call is marked as cancelled in the message

#### 6.4 — ask_question with Queued Messages (Edge Case)

This tests that queued messages **do not** auto-respond to an ask_question dialog. The queue is blocked while any ask_question tool is running.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 22d-ask-with-queue)

# Send a prompt that will trigger streaming
tmux-cli send "Refactor the game rendering. Ask me whether to use double buffering or direct rendering before you start. Also add comments to all functions." --pane=<WINDOW_ID>
sleep 2

# Queue a follow-up message while streaming
tmux-cli send "After refactoring, run cargo check to verify." --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli send $'\x1b[13;6u' --pane=<WINDOW_ID> --enter=False

# Wait for ask_question dialog to appear
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22d-ask-with-queue-dialog.txt

# Answer the dialog
tmux-cli send "1" --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0

# After the agent finishes, the queued message should auto-dispatch
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22d-ask-with-queue-final.txt
```

**Verify:**

- The queue indicator still shows the queued message count while the dialog is active
- The queued message does **NOT** auto-respond to the ask_question dialog — the user must manually answer
- Queue dispatch guard blocks: `!isStreaming && runningAskQuestionToolCount === 0` must both be true
- After the dialog is answered and the agent completes its response, the queued message auto-dispatches

#### 6.5 — ask_question with Text in Chatbox (Edge Case)

This tests that text typed into the chatbox is **preserved** when an ask_question dialog fires.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 22e-ask-with-chatbox-text)

# Type something into the chatbox but DON'T submit
tmux-cli send "This is my draft message" --pane=<WINDOW_ID> --enter=False
sleep 1
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22e-chatbox-with-text.txt

# Now send a prompt that triggers ask_question (use a second terminal or queue)
# For this test, submit a prompt that will trigger ask_question
# First clear the draft by selecting all and deleting
tmux-cli send $'\x01' --pane=<WINDOW_ID> --enter=False  # Ctrl+A select all
tmux-cli send $'\x1b[3~' --pane=<WINDOW_ID> --enter=False  # Delete
tmux-cli send "Ask me what board size I want for the snake game." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22e-ask-dialog-active.txt

# Verify: chatbox textarea is hidden, replaced by the dialog
# Answer the dialog
tmux-cli send "1" --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22e-ask-with-chatbox-final.txt
```

**Verify:**

- When `ask_question` fires, the chatbox textarea is **hidden** (not rendered) and replaced by the inline dialog
- Any text in the textarea state is **preserved in memory** — the React state is not cleared
- After the dialog is answered, the chatbox textarea **reappears** with the preserved text (if any was in state)
- The dialog does **not** overlay the chatbox — it **replaces** it in the render tree

### Phase 7: Autocomplete

#### 7.1 — Slash Command Autocomplete

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 23-autocomplete-slash)
# Type "/" to trigger autocomplete, then a partial command
tmux-cli send "/" --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-23-autocomplete-slash-final.txt

# Navigate with Down arrow and dismiss with ESC
tmux-cli send $'\x1b[B\x1b[B' --pane=<WINDOW_ID> --enter=False
sleep 2
stop_polling $POLL_PID
tmux-cli send $'\x1b' --pane=<WINDOW_ID> --enter=False
```

**Verify:** Autocomplete dropdown appears with command names and descriptions in two columns.

#### 7.2 — Agent Autocomplete

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 24-autocomplete-agent)
# Type "@" to trigger agent autocomplete
tmux-cli send "@" --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-24-autocomplete-agent-final.txt
stop_polling $POLL_PID

# Dismiss with ESC
tmux-cli send $'\x1b' --pane=<WINDOW_ID> --enter=False
```

**Verify:** Agent names appear in dropdown with descriptions. Substring matching works.

### Phase 8: Task List (Ctrl+T)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 25-task-list)
# Toggle task list panel
tmux-cli send $'\x14' --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-25-task-list-final.txt

# Toggle it off
tmux-cli send $'\x14' --pane=<WINDOW_ID> --enter=False
sleep 2
stop_polling $POLL_PID
```

**Verify:** Task list panel toggles visibility. Shows tasks with checkboxes and status indicators.

### Phase 9: Interruption, Cancellation & Exit

#### 9.1 — Ctrl+C Interrupt + Follow-up Message

Verify that after interrupting a stream with Ctrl+C, the chatbox returns to an input-ready state and a new message can be sent immediately.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 26-interrupt-ctrlc)
# Send a prompt that will generate a long response
tmux-cli send "Write comprehensive documentation for every function in the snake game. Include parameter descriptions, return values, examples, and edge cases for each function." --pane=<WINDOW_ID>
sleep 3

# Interrupt with Ctrl+C
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-26-interrupt-ctrlc.txt

# Immediately send a follow-up message to confirm cancellation was applied
tmux-cli send "Just say hello." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-26-interrupt-ctrlc-followup-final.txt
```

**Verify:**

- Streaming stops immediately when Ctrl+C is pressed
- The interrupted message is preserved with `wasInterrupted: true` — partial response is visible
- Tool calls in progress show interrupted status indicator
- The chatbox textarea is **immediately** input-ready (no blocking state)
- The follow-up message sends successfully, confirming the stream was fully cancelled
- Background agents (if any) are **not** affected — only foreground agents are interrupted
- A "Press Ctrl-C again to exit" warning briefly appears in the footer (1000ms timeout)

#### 9.2 — ESC Interrupt + Follow-up Message

ESC also interrupts streaming, but with key differences from Ctrl+C.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 27-interrupt-esc)
# Send a prompt that will generate a long response
tmux-cli send "List all possible improvements to the snake game with detailed implementation plans for each one. Be extremely thorough." --pane=<WINDOW_ID>
sleep 3

# Interrupt with ESC
tmux-cli send $'\x1b' --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-27-interrupt-esc.txt

# Send a follow-up message to confirm cancellation
tmux-cli send "Just say hi." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=10.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-27-interrupt-esc-followup-final.txt
```

**Verify:**

- Streaming stops (same mechanism as Ctrl+C)
- The chatbox is immediately input-ready
- Follow-up message sends successfully
- **Unlike Ctrl+C**: ESC does **not** show a "Press again to exit" warning
- **Unlike Ctrl+C**: ESC does **not** support double-press exit — it always interrupts only
- ESC first dismisses autocomplete or queue editing if either is active, then interrupts on the next press

#### 9.3 — Ctrl+C Interrupt with Queued Messages

Verify that the message queue is **preserved** on Ctrl+C interrupt and queued messages auto-dispatch after interruption.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 28-interrupt-with-queue)

# Send a long prompt
tmux-cli send "Write a complete README.md for the snake game project with installation instructions, gameplay guide, and screenshots placeholder." --pane=<WINDOW_ID>
sleep 2

# Queue a follow-up message during streaming
tmux-cli send "Also add a CHANGELOG.md file." --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli send $'\x1b[13;6u' --pane=<WINDOW_ID> --enter=False
sleep 1

# Verify queue indicator shows "1 message queued"
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-28-interrupt-queue-during.txt

# Interrupt with Ctrl+C
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-28-interrupt-queue-after-ctrlc.txt

# The queued message should auto-dispatch after the interrupt
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-28-interrupt-queue-final.txt
```

**Verify:**

- The queue is **NOT cleared** on Ctrl+C — `messageQueue.clear()` is never called in the interrupt handler
- After the stream is interrupted, `continueQueuedConversation()` is called automatically
- The next queued message auto-dispatches after a 50ms delay
- The queued message's response streams normally as if it were a fresh user message

#### 9.4 — Double Ctrl+C to Exit (Idle State)

When not streaming, double Ctrl+C within 1000ms exits the TUI application.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 29-double-ctrlc-exit)

# First Ctrl+C — shows warning
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
sleep 0.3
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-29-double-ctrlc-warning.txt

# Second Ctrl+C within 1000ms — exits the application
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
sleep 2
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-29-double-ctrlc-exited.txt
```

**Verify:**

- First Ctrl+C shows `"Press Ctrl-C again to exit"` in the footer
- The warning auto-clears after **1000ms** if a second press doesn't come
- Second Ctrl+C within the 1000ms window triggers `onExit()` and the TUI process exits cleanly
- If the second Ctrl+C comes **after** 1000ms, it is treated as a new first press (timer restarts)

#### 9.5 — Double Ctrl+C to Exit Workflow

During an active workflow (e.g., `/ralph`), double Ctrl+C terminates the workflow.

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 30-workflow-double-ctrlc)

# Start a workflow
tmux-cli send "/ralph Add a splash screen to the snake game." --pane=<WINDOW_ID>
sleep 5

# First Ctrl+C — interrupts current stream, workflow enters waitForUserInput
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
sleep 1
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-30-workflow-first-ctrlc.txt

# Second Ctrl+C — terminates the workflow entirely
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=5.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-30-workflow-double-ctrlc-final.txt
```

**Verify:**

- First Ctrl+C during workflow: interrupts the stream, sets `wasInterrupted: true`, workflow pauses
- Footer shows: `workflow · esc to interrupt · ctrl+shift+enter enqueue · ctrl+c twice to exit workflow`
- Second Ctrl+C: sets `wasCancelled: true`, terminates the workflow, rejects `waitForUserInputResolver`
- After termination, the chatbox returns to normal (non-workflow) mode
- **Note**: ESC in a workflow only interrupts (single behavior) — it does **not** support double-press workflow termination

#### 9.6 — Multi-line Input (Shift+Enter)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 31-multiline)
# Send multi-line input using Shift+Enter (inserts newline without submitting)
tmux-cli send "Add these features:" --pane=<WINDOW_ID> --enter=False
tmux-cli send $'\x1b[13;2u' --pane=<WINDOW_ID> --enter=False  # Shift+Enter
tmux-cli send "1. Color the snake green" --pane=<WINDOW_ID> --enter=False
tmux-cli send $'\x1b[13;2u' --pane=<WINDOW_ID> --enter=False  # Shift+Enter
tmux-cli send "2. Color the food red" --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-31-multiline-final.txt

# Submit with Enter
tmux-cli send "" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
```

**Verify:** Input box expands to show multiple lines before submission. Shift+Enter inserts a newline without submitting.

### Phase 10: Workflow — `/ralph`

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 32-ralph)
tmux-cli send "/ralph Add a main menu screen with Play, High Scores, and Quit options. The menu should render in the terminal with arrow key navigation." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=60.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-32-ralph-final.txt
```

**Verify:**

- Ralph workflow starts: task decomposition → worker dispatch → review & fix
- Task list updates in real-time with worker progress (ToDo widget should be able to update the task list)
- Multiple sub-agents spawn and complete
- Final review cycle runs

### Phase 11: Final Verification & Cleanup

#### 11.1 — Verify the Game Builds

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 33-final-build)
tmux-cli send "Run cargo build --release and confirm the snake game compiles successfully." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=20.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-33-final-build-final.txt
```

**Verify:** `cargo build --release` succeeds. Binary produced.

#### 11.2 — `/clear` and `/exit`

```bash
# Clear session
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 34-clear)
tmux-cli send "/clear" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-34-clear-final.txt

# Exit
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 35-exit)
tmux-cli send "/exit" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-35-exit-final.txt

# Kill the window
tmux-cli kill --pane=<WINDOW_ID>
```

**Verify:** `/clear` resets all messages and session state. `/exit` cleanly exits the TUI.

---

## Feature Coverage Matrix

Every feature below MUST be verified during the test run. Check each one as you go.

### Slash Commands

- [ ] `/help` — shows all commands grouped by category
- [ ] `/theme light` / `/theme dark` — switches theme, colors change
- [ ] `/model list` — lists models with providers
- [ ] `/model select` — opens interactive selector dialog
- [ ] `/mcp` — lists MCP servers with status
- [ ] `/compact` — compacts context, summary appears
- [ ] `/clear` — resets session and messages
- [ ] `/exit` — cleanly exits the application

### Keyboard Shortcuts

- [ ] `Ctrl+C` — interrupts streaming response (foreground agents only, background agents preserved)
- [ ] `Ctrl+C` + follow-up message — chatbox is immediately input-ready after interrupt
- [ ] `Ctrl+C` twice (idle, within 1000ms) — exits application
- [ ] `Ctrl+C` twice (workflow) — terminates workflow entirely
- [ ] `Ctrl+C` with queued messages — queue is preserved and auto-dispatches after interrupt
- [ ] `ESC` — interrupts streaming (same as Ctrl+C but no double-press exit support)
- [ ] `ESC` + follow-up message — chatbox is immediately input-ready after interrupt
- [ ] `ESC` — dismisses autocomplete or queue editing before interrupting stream
- [ ] `Ctrl+O` — toggles verbose/compact transcript mode
- [ ] `Ctrl+T` — toggles task list panel
- [ ] `Ctrl+F` — double-press to terminate all background agents
- [ ] `Cmd+Shift+Enter` (macOS) / `Ctrl+Shift+Enter` (Linux/Windows) — queues message during streaming
- [ ] `Enter` — submits message
- [ ] `Shift+Enter` — inserts newline (multi-line input)
- [ ] `Up/Down` arrows — scrolls messages, navigates history, or edits queued messages
- [ ] `PageUp/PageDown` — half-screen scroll
- [ ] `Tab` — completes autocomplete suggestion

### Tool Calls

- [ ] Bash tool — shows command + output with syntax highlighting
- [ ] Edit/Create tool — shows file path + diff coloring
- [ ] Read tool — shows file path + content
- [ ] Tool status indicators — `○` pending, `●` blinking running, `●` green completed, `●` red error
- [ ] Expandable tool output — long outputs collapsed with expand option

### MCP Tool Calls

- [ ] MCP servers discovered and listed via `/mcp`
- [ ] MCP tool calls render with server/tool name
- [ ] MCP enable/disable works via `/mcp enable/disable <server>`

### Message Queuing

- [ ] `Cmd+Shift+Enter` (macOS) / `Ctrl+Shift+Enter` (Linux/Windows) enqueues message during streaming
- [ ] Queue indicator appears above chatbox with icon, count, and first message preview
- [ ] Queued messages process sequentially (FIFO) after response completes (50ms dispatch delay)
- [ ] Queue is preserved on Ctrl+C interrupt — auto-dispatches after interruption
- [ ] `Up/Down` arrows edit queued messages (loads content into textarea, auto-saves on navigation)
- [ ] Queue indicator expands to non-compact mode during editing (shows numbered list)
- [ ] Footer shows enqueue shortcut hint during streaming
- [ ] Placeholder changes to `"Press ↑ to edit queued messages..."` when queue is non-empty and not streaming

### Ask-Question / HITL Dialog

- [ ] Inline dialog renders within chat scrollbox (not a modal overlay)
- [ ] Chatbox textarea is hidden while dialog is active
- [ ] Number keys (1-9) directly select and submit model-provided options (single-select)
- [ ] Up/Down navigates options with highlighted cursor
- [ ] Enter confirms selection
- [ ] "Type something." and "Chat about this" special options appear at bottom of every dialog
- [ ] Custom input mode: selecting "Type something." opens textarea within dialog
- [ ] ESC in custom input mode exits textarea back to option list (first ESC), then dismisses dialog (second ESC)
- [ ] ESC on option list sends cancellation response (`cancelled: true`, `responseMode: "declined"`)
- [ ] Multi-select mode uses Ctrl+Enter / Cmd+Enter to submit selected items
- [ ] ask_question with queued messages: queue is blocked, does NOT auto-respond to dialog
- [ ] ask_question with text in chatbox: text preserved in state, chatbox hidden during dialog
- [ ] Queue resumes after ask_question completes: dispatch guard requires `runningAskQuestionToolCount === 0`

### Session Management

- [ ] Session scrolling (Up/Down, PageUp/PageDown)
- [ ] Transcript mode toggle (Ctrl+O, verbose/compact)
- [ ] Context compaction (`/compact`)
- [ ] Session reset (`/clear`)
- [ ] Command history (Up/Down with empty input)

### Agents & Skills

- [ ] Sub-agent invocation (`@agent-name <task>`)
- [ ] Agent autocomplete (`@` triggers dropdown)
- [ ] Parallel agent tree renders with live status
- [ ] `/research-codebase` skill executes and produces output
- [ ] Skill loading indicator appears

### Workflows

- [ ] `/ralph` decomposes tasks and dispatches workers
- [ ] Task list updates in real-time
- [ ] Worker sub-agents execute and complete
- [ ] Review & fix cycle runs

### Model Selection

- [ ] `/model list` shows available models
- [ ] `/model select` opens interactive dialog
- [ ] Model switching works and footer updates
- [ ] Reasoning effort selection for supported models

### Themes

- [ ] `/theme light` applies light theme
- [ ] `/theme dark` applies dark theme
- [ ] Colors change across all UI elements

### Streaming Metadata

- [ ] Elapsed time displayed during streaming
- [ ] Token count shown (output tokens)
- [ ] Spinner animation visible
- [ ] Completion summary on stream end

### Autocomplete

- [ ] `/` triggers command autocomplete
- [ ] `@` triggers agent/file autocomplete
- [ ] Two-column layout (name + description)
- [ ] Tab completes without executing
- [ ] Enter completes and executes

### Footer Status Bar

- [ ] Model ID displayed
- [ ] Streaming footer shows: `esc to interrupt · ctrl+shift+enter enqueue`
- [ ] Workflow footer shows: `workflow · esc to interrupt · ctrl+shift+enter enqueue · ctrl+c twice to exit workflow`
- [ ] Background agents: `[N] local agents · ctrl+f to kill all background tasks`
- [ ] Verbose/compact mode shown
- [ ] Queue count displayed (in queue indicator above chatbox, not in footer)
- [ ] Agent type displayed
- [ ] "Press Ctrl-C again to exit" warning on first Ctrl+C when idle (clears after 1000ms)

---

## Final Steps

1. **Run the full test suite:**

    ```bash
    bun typecheck && bun lint && bun test
    ```

2. **Review all commits made during testing:**

    ```bash
    git log --oneline -20
    ```

3. **Clean up:**
    - Remove `issues.md` or temp files created during debugging
    - Ensure no test artifacts are committed to the repo
    - Remove `/tmp/snake_game/` directories if no longer needed
