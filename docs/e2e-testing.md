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

    ```bash
    export ATOMIC_PROJECT_DIR=~/Documents/projects/atomic
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

| Command                                            | Description                                                    |
| -------------------------------------------------- | -------------------------------------------------------------- |
| `tmux-cli launch "cmd"`                            | Launches in a new window when `MODE: REMOTE`. **Always launch `zsh` first.** |
| `tmux new-window -P -F '#S:#I.0' -n name "cmd"`   | Creates a new window when `MODE: LOCAL`; use the returned `session:window.pane` as `WINDOW_ID`. |
| `tmux-cli send "text" --pane=ID`                   | Send text + Enter to a window's main pane                      |
| `tmux-cli send "text" --pane=ID --enter=False`     | Send text without pressing Enter                               |
| `tmux-cli send "text" --pane=ID --delay-enter=0.5` | Custom delay before Enter (seconds)                            |
| `tmux-cli capture --pane=ID`                       | Capture output from a window's main pane                       |
| `tmux-cli wait_idle --pane=ID --idle-time=3.0`     | Wait until output is idle for N seconds                        |
| `tmux-cli status`                                  | Show current tmux location and targets                         |
| `tmux-cli list_windows`                            | List windows in the managed remote session                     |
| `tmux-cli kill --pane=ID`                          | Kill a window by targeting its `WINDOW_ID`                     |
| `tmux-cli help`                                    | Show full help documentation                                   |

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

#### 3.3 — Message Queuing (Ctrl+Q)

While the agent is still streaming from the previous step (or send a new long prompt), test message queuing:

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 10-message-queue)

# Send a prompt that will trigger a long response
tmux-cli send "Add a high score system that persists to a file called highscores.txt, and add a pause feature with the P key." --pane=<WINDOW_ID>

# Immediately queue a follow-up message (Ctrl+Q = \x11)
sleep 2
tmux-cli send $'\x11' --pane=<WINDOW_ID> --enter=False
sleep 0.5
tmux-cli send "Also add a speed increase every 5 points to make the game progressively harder." --pane=<WINDOW_ID>
tmux-cli send $'\x11' --pane=<WINDOW_ID> --enter=False

tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-10-message-queue-final.txt
```

**Verify:**

- Queue indicator appears in footer (e.g., "1 queued")
- Input placeholder changes to streaming mode text
- Queued message processes automatically after the first response completes

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

#### 5.1 — Sub-Agent Invocation (`@agent`)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 19-agent-debugger)
tmux-cli send "@debugger Check if the snake game compiles. Run cargo check and report any issues." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-19-agent-debugger-final.txt
```

**Verify:**

- Agent part renders with agent name and status
- Parallel agent tree shows live status updates (pending → running → completed)
- Sub-agent result displayed inline

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
# Select an option (e.g., press 1 for first option)
tmux-cli send "1" --pane=<WINDOW_ID> --enter=False
sleep 0.5
tmux-cli send "" --pane=<WINDOW_ID>  # Enter to confirm
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-22-ask-question-answered-final.txt
```

**Verify:**

- Modal dialog renders with numbered options
- Keyboard selection works (number keys, Up/Down arrows)
- Response is captured and agent continues with the selected choice
- HITL response rendered inline with the tool call

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

### Phase 9: Interrupt & Multi-line Input

#### 9.1 — Interrupt Streaming (Ctrl+C)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 26-interrupt)
# Send a prompt that will generate a long response
tmux-cli send "Write comprehensive documentation for every function in the snake game. Include parameter descriptions, return values, examples, and edge cases for each function." --pane=<WINDOW_ID>
sleep 3

# Interrupt with Ctrl+C
tmux-cli send $'\x03' --pane=<WINDOW_ID> --enter=False
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-26-interrupt-final.txt
```

**Verify:** Streaming stops. Interrupted tool shows `●` yellow indicator. Partial response preserved.

#### 9.2 — Multi-line Input (Shift+Enter)

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 27-multiline)
# Send multi-line input using Shift+Enter (sends newline without submitting)
# Note: Shift+Enter may need to be sent as a literal newline without Enter
tmux-cli send "Add these features:" --pane=<WINDOW_ID> --enter=False
tmux-cli send $'\x1b[13;2u' --pane=<WINDOW_ID> --enter=False  # Shift+Enter
tmux-cli send "1. Color the snake green" --pane=<WINDOW_ID> --enter=False
tmux-cli send $'\x1b[13;2u' --pane=<WINDOW_ID> --enter=False  # Shift+Enter
tmux-cli send "2. Color the food red" --pane=<WINDOW_ID> --enter=False
sleep 2
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-27-multiline-final.txt

# Submit with Enter
tmux-cli send "" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=15.0
stop_polling $POLL_PID
```

**Verify:** Input box expands to show multiple lines before submission.

### Phase 10: Workflow — `/ralph`

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 28-ralph)
tmux-cli send "/ralph Add a main menu screen with Play, High Scores, and Quit options. The menu should render in the terminal with arrow key navigation." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=60.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-28-ralph-final.txt
```

**Verify:**

- Ralph workflow starts: task decomposition → worker dispatch → review & fix
- Task list updates in real-time with worker progress (ToDo widget should be able to update the task list)
- Multiple sub-agents spawn and complete
- Final review cycle runs

### Phase 11: Final Verification & Cleanup

#### 11.1 — Verify the Game Builds

```bash
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 29-final-build)
tmux-cli send "Run cargo build --release and confirm the snake game compiles successfully." --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=20.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-29-final-build-final.txt
```

**Verify:** `cargo build --release` succeeds. Binary produced.

#### 11.2 — `/clear` and `/exit`

```bash
# Clear session
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 30-clear)
tmux-cli send "/clear" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-30-clear-final.txt

# Exit
POLL_PID=$(start_polling <WINDOW_ID> <AGENT> 31-exit)
tmux-cli send "/exit" --pane=<WINDOW_ID>
tmux-cli wait_idle --pane=<WINDOW_ID> --idle-time=3.0
stop_polling $POLL_PID
tmux-cli capture --pane=<WINDOW_ID> > $ATOMIC_PROJECT_DIR/tmux-screenshots/<AGENT>-31-exit-final.txt

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

- [ ] `Ctrl+C` — interrupts streaming response
- [ ] `Ctrl+C` twice — exits application
- [ ] `Ctrl+O` — toggles verbose/compact transcript mode
- [ ] `Ctrl+T` — toggles task list panel
- [ ] `Ctrl+Q` — queues message during streaming
- [ ] `Enter` — submits message
- [ ] `Shift+Enter` — inserts newline (multi-line input)
- [ ] `ESC` — dismisses dialogs/autocomplete
- [ ] `Up/Down` arrows — scrolls messages or navigates history
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

- [ ] `Ctrl+Q` enqueues message during streaming
- [ ] Queue count shown in footer
- [ ] Queued messages process sequentially after response
- [ ] `Up/Down` arrows edit queued messages

### Ask-Question / HITL Dialog

- [ ] Modal dialog renders with numbered options
- [ ] Number keys select options (1-9, 0)
- [ ] Up/Down navigates options
- [ ] Enter confirms selection
- [ ] ESC dismisses dialog
- [ ] Custom text input option works

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
- [ ] Streaming indicator shown
- [ ] Verbose/compact mode shown
- [ ] Queue count displayed
- [ ] Agent type displayed

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
