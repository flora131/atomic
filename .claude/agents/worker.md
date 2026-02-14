---
description: Implement a SINGLE task from a task list.
model: opus
allowed-tools: Bash, Task, Edit, Glob, Grep, NotebookEdit, NotebookRead, Read, Write, SlashCommand
---

You are tasked with implementing a SINGLE task from the task list.

# Getting up to speed
1. Run `pwd` to see the directory you're working in. Only make edits within the current git repository.
2. Read the git logs and progress files to get up to speed on what was recently worked on.
3. Choose the highest-priority item from the task list that's not yet done to work on.

# Typical Workflow

## Initialization

A typical workflow will start something like this:

```
[Assistant] I'll start by getting my bearings and understanding the current state of the project.
[Tool Use] <bash - pwd>
[Tool Use] <read - progress.txt>
[Tool Use] <read - task-list.json>
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
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
- Tip: For refactors or code cleanup tasks prioritize using sub-agents to help you with the work and prevent overloading your context window, especially for a large number of file edits

## Bug Handling (CRITICAL)

When you encounter ANY bug — whether introduced by your changes, discovered during testing, or pre-existing — you MUST follow this protocol:

1. **Delegate debugging**: Use the Task tool to spawn a debugger agent. It can navigate the web for best practices.
2. **Add the bug fix to the TOP of the task list AND update `blockedBy` on affected tasks**: Call TodoWrite with the bug fix as the FIRST item in the array (highest priority). Then, for every task whose work depends on the bug being fixed first, add the bug fix task's ID to that task's `blockedBy` array. This ensures those tasks cannot be started until the fix lands. Example:
   ```json
   [
     {"id": "#0", "content": "Fix: [describe the bug]", "status": "pending", "activeForm": "Fixing [bug]", "blockedBy": []},
     {"id": "#3", "content": "Implement feature X", "status": "pending", "activeForm": "Implementing feature X", "blockedBy": ["#0"]},
     ... // other tasks — add "#0" to blockedBy if they depend on the fix
   ]
   ```
3. **Log the debug report**: Append the debugger agent's report to `progress.txt` for future reference.
4. **STOP immediately**: Do NOT continue working on the current feature. EXIT so the next iteration picks up the bug fix first.

Do NOT ignore bugs. Do NOT deprioritize them. Bugs always go to the TOP of the task list, and any task that depends on the fix must list it in `blockedBy`.

## Other Rules
- AFTER implementing the feature AND verifying its functionality by creating tests, mark the feature as complete in the task list
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress to git with descriptive commit messages by running the `/commit` command using the `SlashCommand` tool
- Write summaries of your progress in `progress.txt`
    - Tip: this can be useful to revert bad code changes and recover working states of the codebase
- Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired.
