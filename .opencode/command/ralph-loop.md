---
description: Start a Ralph Wiggum loop for iterative development
agent: ralph
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
   You are tasked with implementing a SINGLE feature from the `research/feature-list.json` file.

   # Getting up to speed

   1. Run `pwd` to see the directory you're working in. Only make edits within the current git repository.
   2. Read the git logs and progress files (`research/progress.txt`) to get up to speed on what was recently worked on.
   3. Read the `research/feature-list.json` file and choose the highest-priority features that's not yet done to work on.

   # Typical Workflow

   ## Initialization

   A typical workflow will start something like this:

   ```
   [Assistant] I'll start by getting my bearings and understanding the current state of the project.
   [Tool Use] <bash - pwd>
   [Tool Use] <read - research/progress.txt>
   [Tool Use] <read - research/feature-list.json>
   [Assistant] Let me check the git log to see recent work.
   [Tool Use] <bash - git log --oneline -20>
   [Assistant] Now let me check if there's an init.sh script to restart the servers.
   <Starts the development server>
   [Assistant] Excellent! Now let me navigate to the application and verify that some fundamental features are still working.
   <Tests basic functionality>
   [Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. The core chat features, theme switching, conversation loading, and error handling are all functioning correctly. Now let me review the tests.json file more comprehensively to understand what needs to be implemented next.
   <Starts work on a new feature>
   ```

   ## Test-Driven Development

   Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

   ### Testing Anti-Patterns

   Use your testing-anti-patterns skill to avoid common pitfalls when writing tests.

   ## Design Principles

   ### Feature Implementation Guide: Managing Complexity

   Software engineering is fundamentally about **managing complexity** to prevent technical debt. When implementing features, prioritize maintainability and testability over cleverness.

   **1. Apply Core Principles (The Axioms)**
   * **SOLID:** Adhere strictly to these, specifically **Single Responsibility** (a class should have only one reason to change) and **Dependency Inversion** (depend on abstractions/interfaces, not concrete details).
   * **Pragmatism:** Follow **KISS** (Keep It Simple) and **YAGNI** (You Aren't Gonna Need It). Do not build generic frameworks for hypothetical future requirements.

   **2. Leverage Design Patterns**
   Use the "Gang of Four" patterns as a shared vocabulary to solve recurring problems:
   * **Creational:** Use *Factory* or *Builder* to abstract and isolate complex object creation.
   * **Structural:** Use *Adapter* or *Facade* to decouple your core logic from messy external APIs or legacy code.
   * **Behavioral:** Use *Strategy* to make algorithms interchangeable or *Observer* for event-driven communication.

   **3. Architectural Hygiene**
   * **Separation of Concerns:** Isolate business logic (Domain) from infrastructure (Database, UI).
   * **Avoid Anti-Patterns:** Watch for **God Objects** (classes doing too much) and **Spaghetti Code**. If you see them, refactor using polymorphism.

   **Goal:** Create "seams" in your software using interfaces. This ensures your code remains flexible, testable, and capable of evolving independently.

   ## Important notes:
   - ONLY work on the SINGLE highest priority feature at a time then STOP
     - Only work on the SINGLE highest priority feature at a time.
     - Use the `research/feature-list.json` file if it is provided to you as a guide otherwise create your own `feature-list.json` based on the task.
   - If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
   - Tip: For refactors or code cleanup tasks prioritize using sub-agents to help you with the work and prevent overloading your context window, especially for a large number of file edits
   - Tip: You may run into errors while implementing the feature. ALWAYS delegate to the debugger agent using the Task tool (you can ask it to navigate the web to find best practices for the latest version) and follow the guidelines there to create a debug report
       - AFTER the debug report is generated by the debugger agent follow these steps IN ORDER:
         1. First, add a new feature to `research/feature-list.json` with the highest priority to fix the bug and set its `passes` field to `false`
         2. Second, append the debug report to `research/progress.txt` for future reference
         3. Lastly, IMMEDIATELY STOP working on the current feature and EXIT
   - You may be tempted to ignore unrelated errors that you introduced or were pre-existing before you started working on the feature. DO NOT IGNORE THEM. If you need to adjust priority, do so by updating the `research/feature-list.json` (move the fix to the top) and `research/progress.txt` file to reflect the new priorities
   - IF at ANY point MORE THAN 60% of your context window is filled, STOP
   - AFTER implementing the feature AND verifying its functionality by creating tests, update the `passes` field to `true` for that feature in `research/feature-list.json`
   - It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
   - Commit progress to git with descriptive commit messages by running the `/commit` command using the `SlashCommand` tool
   - Write summaries of your progress in `research/progress.txt`
       - Tip: this can be useful to revert bad code changes and recover working states of the codebase
   - Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired.
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