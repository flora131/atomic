---
description: Start a Ralph Wiggum loop for iterative development
agent: build
model: anthropic/claude-opus-4-5
---

# Ralph Loop Command

You are starting a Ralph Wiggum loop. This is an iterative development technique where you work on the same task repeatedly, seeing your previous work in files and git history.

## Setup Instructions

Execute the following steps to initialize the Ralph loop:

1. Parse the arguments from: `$ARGUMENTS`

   Arguments format: `<PROMPT> [--max-iterations N] [--completion-promise TEXT] [--feature-list PATH]`

   - Extract the main prompt (everything that isn't a flag or flag value)
   - Extract `--max-iterations` value if provided (default: 0 for unlimited)
   - Extract `--completion-promise` value if provided (default: null)
   - Extract `--feature-list` value if provided (default: "research/feature-list.json")

2. Create the state file at `.opencode/ralph-loop.local.md` (in the project root) with this exact format:

```markdown
---
active: true
iteration: 1
max_iterations: <MAX_ITERATIONS_VALUE>
completion_promise: <COMPLETION_PROMISE_VALUE_OR_null>
feature_list_path: <FEATURE_LIST_PATH_VALUE>
started_at: "<CURRENT_ISO_TIMESTAMP>"
---

<THE_PROMPT_TEXT>
```

   If no custom prompt is provided, use the default prompt:
   ```
   /implement-feature

   <EXTREMELY_IMPORTANT>
   - Implement features incrementally, make small changes each iteration.
     - Only work on the SINGLE highest priority feature at a time.
     - Use the `feature-list.json` file if it is provided to you as a guide otherwise create your own `feature-list.json` based on the task.
   - If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
   </EXTREMELY_IMPORTANT>
   ```

   **IMPORTANT**: If using the default prompt and the feature list file does NOT exist, output an error and do NOT create the state file:
   ```
   Error: Feature list not found at: <FEATURE_LIST_PATH>

   The default /implement-feature prompt requires a feature list to work.

   To fix this, either:
     1. Create the feature list: /create-feature-list
     2. Specify a different path: --feature-list <path>
     3. Use a custom prompt instead
   ```

3. Output the activation message:

```
Ralph loop activated!

Iteration: 1
Max iterations: <N or "unlimited">
Completion promise: <TEXT or "none">
Feature list: <FEATURE_LIST_PATH>

The Ralph plugin will now monitor for session idle events. When you complete
your response, the same prompt will be fed back to continue the loop.

To stop the loop:
- Output <promise>YOUR_PROMISE</promise> if a completion promise is set
- Wait for max iterations to be reached
- All features in feature-list.json are passing (when max_iterations = 0)
- Run /cancel-ralph to cancel manually
```

4. If a completion promise is set, display this critical warning:

```
CRITICAL - Ralph Loop Completion Promise

To complete this loop, output this EXACT text:
  <promise>YOUR_PROMISE_HERE</promise>

STRICT REQUIREMENTS:
  - Use <promise> XML tags EXACTLY as shown above
  - The statement MUST be completely and unequivocally TRUE
  - Do NOT output false statements to exit the loop
  - Do NOT lie even if you think you should exit

IMPORTANT: Even if you believe you're stuck or the task is impossible,
you MUST NOT output a false promise. The loop continues until the
promise is GENUINELY TRUE.
```

5. Now begin working on the task from the prompt. The Ralph plugin will automatically continue feeding you the same prompt when you complete your response.

## Example Usage

```
/ralph-loop                                    (uses /implement-feature, runs until all features pass)
/ralph-loop --max-iterations 20                (uses /implement-feature with iteration limit)
/ralph-loop --feature-list specs/features.json (use custom feature list path)
/ralph-loop Build a REST API for todos --completion-promise "DONE" --max-iterations 20
/ralph-loop Fix the auth bug --max-iterations 10
/ralph-loop Refactor the cache layer
```