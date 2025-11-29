---
agent: 'agent'
model: 'Claude Sonnet 4.5'
tools: ['githubRepo', 'search/codebase', 'runCommands/runInTerminal', 'runCommands/getTerminalOutput', 'editFiles', 'usePlaywright']
description: Implement a SINGLE feature from `feature-list.json` based on the provided execution plan.

---

# Implement Feature

You are tasked with implementing a SINGLE feature from the `feature-list.json` file.

## Getting Up to Speed

1. Run `pwd` to see the directory you're working in. You'll only be able to edit files in this directory and its subdirectories.
2. Read the git logs and progress files (`claude-progress.txt`) to get up to speed on what was recently worked on.
3. Read the `feature-list.json` file and choose the highest-priority features that's not yet done to work on.

## Typical Workflow

### Initialization

A typical workflow will start something like this:

```
[Assistant] I'll start by getting my bearings and understanding the current state of the project.
[Tool Use] <bash - pwd>
[Tool Use] <read - claude-progress.txt>
[Tool Use] <read - feature_list.json>
[Assistant] Let me check the git log to see recent work.
[Tool Use] <bash - git log --oneline -20>
[Assistant] Now let me check if there's an init.sh script to restart the servers.
<Starts the development server>
[Assistant] Excellent! Now let me navigate to the application and verify that some fundamental features are still working.
<Tests basic functionality>
[Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. The core chat features, theme switching, conversation loading, and error handling are all functioning correctly. Now let me review the tests.json file more comprehensively to understand what needs to be implemented next.
<Starts work on a new feature>
```

### Test-Driven Development

Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

#### Testing Anti-Patterns

Avoid common testing pitfalls:
- Don't test mock behavior instead of real behavior
- Don't add test-only methods to production code
- Don't mock without understanding dependencies
- Ensure tests verify actual functionality, not just code coverage

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

## Implementation Steps

1. **Read the feature specification** from `feature-list.json`
2. **Understand the context** by reading related code and documentation
3. **Plan the implementation** - break down into smaller steps
4. **Implement the feature** following the design principles above
5. **Write tests** to verify the implementation
6. **Update documentation** if needed
7. **Mark feature as complete** in `feature-list.json`

## Important Notes

- **ONLY implement a SINGLE feature then STOP**
- **AFTER implementing the feature AND verifying its functionality by creating tests**, update the `passes` field to `true` for that feature in `feature-list.json`
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress to git with descriptive commit messages
- Write summaries of your progress in `claude-progress.txt`
  - Tip: this can be useful to revert bad code changes and recover working states of the codebase

## Progress Tracking

After implementing the feature, update `claude-progress.txt` with:

```markdown
## [Date] - Feature: [Feature Description]

### What was implemented
- [Description of changes]

### Files modified
- `path/to/file.ext` - [Brief description of changes]

### Tests added
- `path/to/test.ext` - [What the tests verify]

### Notes
- [Any important observations or decisions made]

### Next steps
- [What should be worked on next]
```

## Commit Guidelines

When committing your work:
- Use conventional commit format: `feat: description`, `fix: description`, `test: description`
- Include AI attribution trailer
- Ensure all pre-commit hooks pass
- Keep commits atomic and focused
