# E2E Test & Bug Verification Suite

> **Purpose:** Run end-to-end tests of all workflows in the codebase (`/research-codebase` -> `/create-spec` -> `/ralph`) across all three agents (claude, opencode, copilot), while simultaneously verifying that three known TUI bugs are fixed and stay fixed. Any regression or new bug discovered during testing MUST be fixed and committed before proceeding.

---

## Prerequisites

Before starting any tests, complete these setup steps exactly:

1. Set `ATOMIC_PROJECT_DIR` env var to the root of your local Atomic clone:

    ```bash
    export ATOMIC_PROJECT_DIR=/path/to/your/atomic/clone
    ```

2. **Clone the test fixture project:**

    ```bash
    rm -rf /tmp/rust-snake && git clone https://github.com/SLMT/rust-snake /tmp/rust-snake
    ```

3. **Create a tmux screenshots directory:**

    ```bash
    mkdir -p ./tmux-screenshots
    ```

4. **Read the three open bug issues for full context:**

    ```bash
    gh issue view 200  # Non-built-in skill slash commands silently drop user arguments
    gh issue view 204  # Stopped parallel subagents respawn automatically and leak across prompts
    gh issue view 205  # Skill loading indicator appears twice in terminal UI
    ```

5. **Verify the project builds and existing tests pass:**
    ```bash
    bun install
    bun typecheck
    bun lint
    bun test
    ```
    If any of these fail, fix them before proceeding. Do NOT begin E2E testing on a broken build.

---

## Testing Protocol

### How to Drive the TUI via tmux

Every test MUST be executed inside a tmux session. Follow this exact protocol for every interaction:

1. **Start a tmux session:**

    ```bash
    tmux new-session -d -s atomic-test -x 200 -y 50
    ```

2. **Launch Atomic inside tmux:**

    ```bash
    tmux send-keys -t atomic-test 'cd /tmp/rust-snake && bun run $ATOMIC_PROJECT_DIR/src/cli.ts chat -a <AGENT>' Enter
    ```

    Replace `<AGENT>` with `claude`, `opencode`, or `copilot` depending on which agent you are testing.

3. **Send commands by typing into the tmux pane:**

    ```bash
    tmux send-keys -t atomic-test '<YOUR COMMAND HERE>' Enter
    ```

4. **Capture TUI state after EVERY significant action:**

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/pane-$(date +%s).txt
    ```

    Always name captures descriptively when saving for evidence:

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-<STEP>-<DESCRIPTION>.txt
    ```

5. **Wait for operations to complete** before capturing. Poll the pane output:

    ```bash
    tmux capture-pane -t atomic-test -p | tail -20
    ```

    Look for the input prompt to reappear, or for the expected output text.

6. **Kill the session when done with a test run:**
    ```bash
    tmux kill-session -t atomic-test
    ```

### When You Find a Bug

If at ANY point during testing you observe a bug (either one of the three known bugs regressing, or a new bug), you MUST:

1. **Stop testing immediately.**
2. **Capture evidence:** Save a tmux pane capture with a descriptive name, e.g.:
    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/BUG-<issue-number-or-description>.txt
    ```
3. **Identify the root cause** in the Atomic source code. Read the relevant files, trace the execution path.
4. **Fix the bug** directly in the Atomic source code.
5. **Verify the fix:**
    - Run `bun typecheck && bun lint && bun test` — all must pass.
    - Re-run the specific test scenario that triggered the bug and capture a new tmux snapshot showing it's fixed.
6. **Commit the fix:**
    ```bash
    git add <specific-files-changed>
    git commit -m "fix(<component>): <concise description of what was fixed>"
    ```
7. **Resume testing from where you left off.**

Do NOT skip bugs. Do NOT mark any test as passed if a bug was observed. Do NOT proceed to the next test phase until all bugs in the current phase are fixed.

---

## Phase 1: Bug Regression Tests (Run FIRST)

These tests verify that the three known bugs are currently fixed. Run them BEFORE the Ralph E2E flow. If any regress here, fix before moving on.

### Test 1.1: Skill Loading Indicator Appears Only Once (Issue #205)

**What to test:** When a skill is loaded via slash command, the loading indicator must appear exactly ONCE.

**Steps:**

1. Start Atomic with the `claude` agent in tmux.
2. Type `/prompt-engineer` and press Enter.
3. When prompted, enter: `Optimize this prompt: Create a hello world program in Rust.`
4. **Immediately start capturing pane output every 1 second for 10 seconds:**
    ```bash
    for i in $(seq 1 10); do
      tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/claude-skill-indicator-t${i}.txt
      sleep 1
    done
    ```
5. **Inspect every captured file.** Count the number of times `skill (prompt-engineer)` appears in each capture.

**Pass criteria:**

- The string `skill (prompt-engineer)` (or equivalent skill loading indicator) appears **at most once** in every single captured pane snapshot.
- If it appears **twice or more** in ANY capture, this is a REGRESSION of issue #205. Fix it.

**Repeat with:** `opencode` and `copilot` agents.

---

### Test 1.2: Stopped Subagents Stay Stopped and Don't Leak (Issue #204)

**What to test:** When parallel subagents are stopped with Escape, they must not respawn. When a new prompt is entered, only new subagents should appear.

**Steps:**

1. Start Atomic with the `claude` agent in tmux.
2. Enter a prompt that spawns parallel subagents. For example, type:
    ```
    Use the codebase-online-researcher to research how the Rust snake game handles rendering
    ```
3. Wait 5 seconds for subagents to begin spawning. Capture the pane:
    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/claude-subagent-spawned.txt
    ```
4. **Press Escape to stop all subagents:**
    ```bash
    tmux send-keys -t atomic-test Escape
    ```
5. Capture immediately after stopping:
    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/claude-subagent-stopped.txt
    ```
6. **Wait 15 seconds.** During this wait, capture the pane every 3 seconds:
    ```bash
    for i in $(seq 1 5); do
      sleep 3
      tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/claude-subagent-respawn-check-${i}.txt
    done
    ```
7. **Inspect all respawn-check captures.** Look for any sign that the stopped subagents have restarted (new agent activity indicators, spinning indicators reappearing, or output from the original research topic).

**Pass criteria (respawn check):**

- No stopped subagent restarts in any of the 5 captures. If subagents respawn, this is a REGRESSION of issue #204. Fix it.

8. **Now test cross-prompt leaking.** Enter a NEW, completely different prompt:
    ```
    Use the codebase-online-researcher to research how Rust's ownership model works
    ```
9. Wait 5 seconds, then capture:
    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/claude-subagent-new-prompt.txt
    ```
10. **Inspect the capture.** Look for ANY reference to the original research topic ("rendering", "snake game rendering") in the active subagent output.

**Pass criteria (leak check):**

- Only subagents related to the NEW prompt ("ownership model") appear. Zero references to the old prompt's topic in active subagent output. If old subagents leaked, this is a REGRESSION of issue #204. Fix it.

**Repeat with:** `opencode` and `copilot` agents.

---

### Test 1.3: Disk-Discovered Skill Commands Preserve User Arguments (Issue #200)

**What to test:** When a non-built-in (disk-discovered) skill is invoked with arguments, the arguments must be received by the agent.

**Steps:**

1. First, verify which disk-discovered skills exist. Check:
    ```bash
    ls -la .github/skills/*/SKILL.md .claude/skills/*/SKILL.md .opencode/skills/*/SKILL.md 2>/dev/null
    ```
2. Pick a disk-discovered skill that exists (e.g., `gh-commit`, `sl-commit`, or any custom skill).
3. Start Atomic with the `claude` agent in tmux.
4. Invoke the disk skill WITH explicit arguments. For example:
    ```
    /gh-commit Fix the rendering logic in the snake game
    ```
5. Wait for the agent to respond. Capture the pane:
    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/claude-disk-skill-args.txt
    ```
6. **Inspect the agent's response.** The agent should be acting on the user's specific request ("Fix the rendering logic in the snake game"), NOT asking "What would you like me to do?" or responding generically.

**Pass criteria:**

- The agent's response demonstrates awareness of the user's arguments. It should reference the specific task described ("rendering logic", "snake game", or similar).
- If the agent responds generically or asks what to do (as if no arguments were provided), this is a REGRESSION of issue #200. Fix it.

**Additional validation:** Read `src/ui/commands/skill-commands.ts` and verify:

- The `expandArguments` function has a fallback that appends user args even when `$ARGUMENTS` is not in the SKILL.md template.
- OR all disk SKILL.md files include `$ARGUMENTS`.
- Capture this evidence:
    ```bash
    grep -n "ARGUMENTS" .github/skills/*/SKILL.md 2>/dev/null
    ```
    If any SKILL.md lacks `$ARGUMENTS` AND the code has no fallback, this is still a bug. Fix the code.

**Repeat with:** `opencode` and `copilot` agents.

---

## Phase 2: Ralph E2E Flow (Run AFTER Phase 1 passes completely)

This phase tests the full Ralph pipeline. Every handoff between stages is a potential regression point. Test each transition meticulously.

The test fixture is the `rust-snake` project cloned to `/tmp/rust-snake`.

### Test 2.1: `/research-codebase` Execution

**Run for each agent:** `claude`, `opencode`, `copilot`.

**Steps:**

1. Start Atomic in tmux pointed at the test fixture:
    ```bash
    tmux send-keys -t atomic-test 'cd /tmp/rust-snake && bun run $ATOMIC_PROJECT_DIR/src/cli.ts chat -a <AGENT>' Enter
    ```
2. Wait for the TUI to fully load (input prompt visible).
3. Run the research command:
    ```
    /research-codebase How does the rust-snake project structure its game loop, rendering, and input handling?
    ```
4. **Capture the pane immediately after pressing Enter:**

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-research-started.txt
    ```

5. **Verify the skill loaded correctly (no double indicator — cross-check with Issue #205):**
    - The capture should show the research-codebase skill loading indicator at most once.

6. **Verify arguments were received (cross-check with Issue #200):**
    - The agent should be acting on the specific research question, NOT asking "What would you like to research?"

7. **Wait for research to complete.** This will take time. Poll every 30 seconds:

    ```bash
    tmux capture-pane -t atomic-test -p | tail -30
    ```

    Look for the agent to indicate research is complete, or for the input prompt to return.

8. **While waiting, verify subagent behavior (cross-check with Issue #204):**
    - If parallel subagents spawn, capture and verify they are properly managed.
    - If you press Escape at any point to stop, subagents must not respawn.

9. **Once complete, verify a research document was created:**

    ```bash
    ls -la /tmp/rust-snake/research/docs/
    ```

    Capture the filename(s) of the generated research documents.

10. **Capture the research file path** — you will need this EXACT path for the next step:
    ```bash
    RESEARCH_PATH=$(ls -t /tmp/rust-snake/research/docs/*.md | head -1)
    echo "Research path: $RESEARCH_PATH"
    ```

**Pass criteria:**

- [ ] Skill loading indicator appeared at most once
- [ ] Agent received and acted on the research question (not generic)
- [ ] Subagents (if spawned) behaved correctly (no respawn, no leak)
- [ ] At least one research document was created in `research/docs/`
- [ ] The research document contains substantive findings about the rust-snake project
- [ ] The input prompt returned after completion (the TUI is not hung/stuck)

**If ANY criterion fails, stop, fix the bug, commit, and re-run this test.**

---

### Test 2.2: `/create-spec` With Research Path Handoff

**This is a critical handoff point.** The path from `/research-codebase` output must be correctly consumed by `/create-spec`.

**Steps:**

1. **In the SAME Atomic session** (do NOT restart — this tests session continuity), run:

    ```
    /create-spec research/docs/<THE-EXACT-FILENAME-FROM-STEP-2.1>
    ```

    Use the EXACT filename from the research output. For example:

    ```
    /create-spec research/docs/2026-02-15-rust-snake-game-loop.md
    ```

2. **Capture immediately:**

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-create-spec-started.txt
    ```

3. **Verify the path was accepted (CRITICAL — this is the handoff regression test):**
    - The agent should NOT say "file not found", "cannot read", or "what research path?"
    - The agent should be reading the research document and beginning spec creation.
    - If the agent cannot find the file, this is a PATH HANDOFF BUG. Investigate:
        - Is the path relative vs absolute?
        - Did `research-codebase` create the file in a different directory than expected?
        - Is there a CWD mismatch between what the agent sees and where the file lives?
    - Fix and commit before proceeding.

4. **Verify skill loading indicator (cross-check #205):** appears at most once.

5. **Verify arguments (the research path) were received (cross-check #200):**
    - The agent must be using the specific research document, not the entire research/ directory.

6. **Wait for spec creation to complete.** Poll:

    ```bash
    tmux capture-pane -t atomic-test -p | tail -30
    ```

7. **Verify a spec was created:**

    ```bash
    ls -la /tmp/rust-snake/specs/
    ```

    Capture the spec filename.

8. **Verify spec content references the research:**
    ```bash
    head -50 /tmp/rust-snake/specs/<SPEC-FILENAME>
    ```
    The spec should contain references to findings from the research document.

**Pass criteria:**

- [ ] The research path argument was correctly received and resolved
- [ ] The agent read the research document (not a generic response)
- [ ] Skill loading indicator appeared at most once
- [ ] A spec file was created in `specs/`
- [ ] The spec contains substantive content derived from the research
- [ ] The TUI is responsive and not hung after completion

**If ANY criterion fails, stop, fix the bug, commit, and re-run this test.**

---

### Test 2.3: `/ralph` With Spec Path Handoff

**This is the second critical handoff and the most complex step.**

**Steps:**

1. **In the SAME Atomic session**, run:

    ```
    /ralph specs/<THE-EXACT-SPEC-FILENAME-FROM-STEP-2.2>
    ```

    For example:

    ```
    /ralph specs/rust-snake-refactor.md
    ```

2. **Capture immediately:**

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-ralph-started.txt
    ```

3. **Verify the spec path was accepted (CRITICAL — second handoff regression test):**
    - The agent should NOT say "file not found" or ask what to work on.
    - The agent should be decomposing the spec into tasks.
    - If path resolution fails, investigate the same CWD/relative/absolute issues as in Test 2.2.

4. **Monitor task decomposition (Step 1 of Ralph):**
    - Capture pane output as the task list is being generated.
    - Verify a task list appears in the TUI.

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-ralph-tasks.txt
    ```

5. **Monitor worker subagent dispatch (Step 2 of Ralph):**
    - As workers are dispatched, capture the pane:

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-ralph-workers.txt
    ```

    - **Verify subagent behavior (cross-check #204):** Workers should not respawn if stopped. Workers from one task should not leak into another.

6. **Verify the task list UI renders correctly:**
    - Tasks should show status transitions (pending -> in_progress -> completed).
    - No duplicate indicators or ghost entries.

7. **Wait for Ralph to complete.** This may take a while. Poll every 30 seconds and capture:

    ```bash
    for i in $(seq 1 20); do
      sleep 30
      tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-ralph-progress-${i}.txt
      # Check if done
      tmux capture-pane -t atomic-test -p | tail -5
    done
    ```

8. **Verify Ralph completed successfully:**
    - All tasks in the task list should show as completed.
    - The TUI should return to the input prompt.
    - No error messages or stack traces visible.

**Pass criteria:**

- [ ] The spec path argument was correctly received and resolved
- [ ] Task decomposition produced a visible task list
- [ ] Worker subagents were dispatched and ran
- [ ] Subagents did not respawn or leak (cross-check #204)
- [ ] No duplicate skill/loading indicators (cross-check #205)
- [ ] All tasks reached completed status
- [ ] The TUI is responsive after Ralph finishes
- [ ] No error messages or stack traces in any capture

**If ANY criterion fails, stop, fix the bug, commit, and re-run this test.**

---

### Test 2.4: `/ralph --resume` (Session Resume)

**Steps:**

1. Kill the current Atomic session and restart it:

    ```bash
    tmux kill-session -t atomic-test
    tmux new-session -d -s atomic-test -x 200 -y 50
    tmux send-keys -t atomic-test 'cd /tmp/rust-snake && bun run $ATOMIC_PROJECT_DIR/src/cli.ts chat -a <AGENT>' Enter
    ```

2. Attempt to resume the Ralph session from Test 2.3. You need the session ID — check:

    ```bash
    ls -la /tmp/rust-snake/.atomic/sessions/ 2>/dev/null || ls -la /tmp/rust-snake/.workflows/ 2>/dev/null
    ```

3. If a session ID is available, run:

    ```
    /ralph --resume <SESSION-ID>
    ```

4. Capture and verify the session resumes correctly:

    ```bash
    tmux capture-pane -t atomic-test -p -e > ./tmux-screenshots/<AGENT>-ralph-resume.txt
    ```

5. Verify:
    - The task list from the previous session is restored.
    - Completed tasks show as completed.
    - The agent can continue from where it left off.

**Pass criteria:**

- [ ] Session resumed without errors
- [ ] Previous task state was restored
- [ ] No duplicate or ghost subagents from the previous session

---

## Phase 3: Cross-Agent Parity Verification

After completing Phases 1 and 2 for ALL three agents, compare results:

1. **Collect all tmux captures:**

    ```bash
    ls -la ./tmux-screenshots/
    ```

2. **Verify each agent produced equivalent outputs:**
    - Each agent should have created research docs in `research/docs/`
    - Each agent should have created specs in `specs/`
    - Each agent should have completed the Ralph task list

3. **Look for agent-specific regressions:**
    - Did any bug appear in only one agent but not others?
    - Did any agent fail to render the task list?
    - Did any agent have different subagent behavior?

4. **Document parity gaps** — if one agent works but another doesn't, investigate whether the bug is in agent-specific code or shared code.

---

## Phase 4: Final Verification

1. **Run the full test suite one final time:**

    ```bash
    bun typecheck && bun lint && bun test
    ```

    ALL must pass.

2. **Review all commits made during testing:**

    ```bash
    git log --oneline -20
    ```

    Each fix commit should be atomic and well-described.

3. **Verify no regressions were introduced by fixes:**
    - If you fixed issue #205, re-run Test 1.1 to confirm.
    - If you fixed issue #204, re-run Test 1.2 to confirm.
    - If you fixed issue #200, re-run Test 1.3 to confirm.

4. **Clean up:**
    - Remove any `issues.md` or temp files created during debugging.
    - Ensure no test artifacts are committed to the repo.

---

## Summary Checklist

Before marking this task as COMPLETE, every single box must be checked:

### Bug Regressions

- [ ] Issue #200 (dropped arguments) — verified fixed across all 3 agents
- [ ] Issue #204 (subagent respawn/leak) — verified fixed across all 3 agents
- [ ] Issue #205 (double skill indicator) — verified fixed across all 3 agents

### Ralph E2E Flow (per agent: claude, opencode, copilot)

- [ ] `/research-codebase` executed successfully and produced research docs
- [ ] `/create-spec <research-path>` correctly received the path and produced a spec
- [ ] `/ralph <spec-path>` correctly received the path, decomposed tasks, dispatched workers, and completed
- [ ] `/ralph --resume` correctly restored session state (if supported by agent)
- [ ] No path resolution errors at any handoff point
- [ ] No TUI hangs, crashes, or unresponsive states

### Code Health

- [ ] `bun typecheck` passes
- [ ] `bun lint` passes
- [ ] `bun test` passes
- [ ] All fix commits are atomic with clear messages

### Evidence

- [ ] tmux captures exist in `./tmux-screenshots/` for every test step
- [ ] Bug fix captures show before/after state
- [ ] No test artifacts left in the repo
