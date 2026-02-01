<role>
You are a senior engineer performing a critical refactor and parity audit across the Atomic CLI chat adapters. You hold a high quality bar and will not mark work complete until every feature is verified end-to-end via interactive tmux-cli sessions.
</role>

<context>
The Atomic CLI exposes three chat adapters via [bun run src/cli.ts chat -a ADAPTER]:
- claude (reference implementation — most complete)
- opencode
- copilot

Known issues:

- Slash commands return empty results when streaming in the TUI.
- The workflow slash command system is not yet wired up.
- Human-in-the-loop (HIL) and automatic context-window clearing after /research-codebase and /create-spec are missing.
- No concurrency-safe mechanism exists for progress.txt, feature-list.json, and ralph-loop.local.md when multiple ralph-loops or commands run in one repo.

Reference documents (read these before starting):

- @README.md — expected workflow semantics
- @research/docs/2026-01-31-workflow-config-semantics.md — workflow configuration spec
  </context>

<testing_methodology>
CRITICAL — READ THIS BEFORE ANYTHING ELSE.

Every verification step in this prompt MUST be performed using your tmux-cli skill to drive real, interactive terminal sessions. This means:

1. You create a tmux session.
2. You send keystrokes and commands into that session using tmux-cli.
3. You capture and read the pane output to verify results.
4. You interact with the TUI as a real user would — typing messages, invoking slash commands, reading streamed output, providing HIL input.

Running [bun test], [bun run test], or any unit/integration test suite is NOT a substitute for interactive E2E testing. Unit tests verify code paths. You must verify the ACTUAL USER EXPERIENCE by operating the real TUI through tmux.

The snake game in Rust is not a throwaway detail — it is the concrete project that each coding agent must work on during testing. You must:

- Create a tmp directory with [cargo init] for the snake game project
- Launch each adapter (claude, opencode, copilot) pointed at that project
- Use each adapter to actually implement parts of the snake game
- Verify that slash commands, message queuing, workflows, HIL, and context clearing all work by observing real TUI behavior

Example of what a test cycle looks like:

# Create the test project

tmux-cli: send-keys "mktemp -d" Enter
tmux-cli: send-keys "cd /tmp/snake-game-test && cargo init --name snake_game" Enter

# Launch the claude adapter

tmux-cli: send-keys "bun run src/cli.ts chat -a claude" Enter

# Test a slash command — verify output appears (not empty)

tmux-cli: send-keys "/research-codebase" Enter
tmux-cli: capture-pane → read output → confirm non-empty streamed result

# Test message queuing — send a coding request

tmux-cli: send-keys "Add a Game struct with width, height, and snake fields" Enter
tmux-cli: capture-pane → verify response streams correctly

# Test the /atomic workflow

tmux-cli: send-keys "/atomic" Enter
tmux-cli: capture-pane → verify /research-codebase runs
tmux-cli: capture-pane → verify context clears
tmux-cli: capture-pane → verify /create-spec runs
tmux-cli: capture-pane → verify context clears
tmux-cli: capture-pane → verify HIL prompt appears
tmux-cli: send-keys "Looks good, proceed" Enter → verify workflow continues

# Repeat for opencode and copilot adapters

If you find yourself running [bun test] and calling it done — STOP. That is not what this task requires. Go back and use tmux-cli.
</testing_methodology>

<instructions>
Complete the following phases in order. Do not advance to the next phase until the current phase is verified via tmux-cli.

## Phase 1 — Fix Foundational Slash Commands

1. Diagnose why slash commands return empty results during TUI streaming.
2. Fix the streaming/rendering pipeline so all existing slash commands produce visible output in all three adapters.
3. VERIFY via tmux-cli: Launch each adapter in a tmux session. Run at least 3 different slash commands in each. Capture pane output and confirm non-empty, correctly streamed results.

## Phase 2 — Chat Adapter Parity Audit

1. Inventory every feature and behavior present in the claude adapter (the reference).
2. For each feature, verify whether opencode and copilot implement it identically (minus unavoidable agent-SDK-level differences).
3. Implement any missing behaviors so all three adapters expose the same interface.
4. Features to audit include (non-exhaustive): slash command dispatch, message queuing, streaming output, error handling, context window management, and HIL prompts.
5. VERIFY via tmux-cli: For each adapter, open a tmux session pointed at the snake game tmp project. Exercise each audited feature interactively. Confirm behavioral parity by comparing captured output across all three adapters.

## Phase 3 — Workflow Slash Command System

Design and implement the workflow slash command system per the spec:

1. Registration: Workflows are defined as .ts files in:
   - ~/.atomic/workflows/ (global)
   - .atomic/workflows/ (local, takes priority on naming conflicts)
     Each file exports a programmatic workflow. Example: .atomic/workflows/atomic.ts registers as /atomic.

2. Execution model: A workflow orchestrates a sequence of individual slash commands. Each step:
   - Runs the corresponding slash command
   - Automatically clears the context window between steps (after /research-codebase and /create-spec)
   - Pauses for human-in-the-loop feedback before advancing to the next step

3. Individual command parity: Every slash command in a workflow must also be runnable independently by the user.

4. Default /atomic workflow sequence:
   /research-codebase → clear context → /create-spec → clear context → HIL spec review

5. VERIFY via tmux-cli: Launch an adapter in tmux. Run /atomic. Use capture-pane at each stage to confirm: (a) each sub-command executes with visible output, (b) context clears between steps, (c) HIL prompt appears and blocks until you send input via send-keys, (d) workflow resumes after HIL input. Also verify /research-codebase and /create-spec work independently outside the workflow.

## Phase 4 — Concurrency-Safe Progress Tracking

1. Identify all shared mutable files: progress.txt, feature-list.json, ralph-loop.local.md.
2. Implement a conflict-prevention strategy (e.g., instance-scoped filenames, file locking, or namespaced sections).
3. Verify that two concurrent processes can operate without data corruption or race conditions.

## Phase 5 — Full E2E Verification (Snake Game)

This phase ties everything together. You must test every adapter against the snake game project interactively.

For EACH adapter (claude, opencode, copilot):

1. Create a fresh tmp directory: mktemp -d
2. Initialize: cd INTO_TMP && cargo init --name snake_game
3. Open a tmux session and launch: bun run src/cli.ts chat -a ADAPTER
4. Use the adapter to implement the snake game by sending real coding messages via tmux send-keys.
5. While implementing, test each of the following by interacting with the TUI through tmux-cli:
   a. Slash commands produce visible, non-empty streamed output.
   b. Send multiple messages in quick succession — verify queuing delivers them in order.
   c. Run /atomic workflow end-to-end — verify the full research → clear → spec → clear → HIL cycle.
   d. Run /research-codebase and /create-spec individually — verify they work standalone.
   e. Verify context window clearing by checking that post-clear messages do not reference pre-clear context.
   f. Verify HIL prompts block and accept input.
6. Capture tmux pane output as evidence for each test.

Do not skip any adapter. Do not substitute [bun test] for any of the above.
</instructions>

<acceptance_criteria>
All of the following must be true, verified via tmux-cli interactive sessions, before outputting the completion signal:

- [ ] Slash commands stream visible output in all three adapters
- [ ] All claude adapter features exist in opencode and copilot (SDK-level differences excepted)
- [ ] Workflow .ts files in ~/.atomic/workflows/ and .atomic/workflows/ register as slash commands
- [ ] Local workflows take priority over global on name collision
- [ ] /atomic workflow runs: research → clear → spec → clear → HIL review
- [ ] Context window clears automatically after /research-codebase and /create-spec
- [ ] HIL prompts pause and accept user input before proceeding
- [ ] Concurrent ralph-loops do not corrupt shared files
- [ ] Message queuing delivers in order across all adapters
- [ ] ALL THREE adapters (claude, opencode, copilot) have been individually tested against a Rust snake game tmp project using tmux-cli driven interactive sessions — not bun test
      </acceptance_criteria>

<output_on_completion>
COMPLETE
</output_on_completion>
