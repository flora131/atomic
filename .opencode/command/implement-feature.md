---
description: Implement a SINGLE feature from feature-list.json based on the provided execution plan.
agent: build
model: anthropic/claude-sonnet-4-5
---

# Implement Feature

You are tasked with implementing a SINGLE feature from the `feature-list.json` file.

## Current Repository State

- Current directory: !`pwd`
- Git branch: !`git branch --show-current`
- Git status: !`git status --porcelain`
- Recent commits: !`git log --oneline -5`

## Getting Up to Speed

1. Run `pwd` to see the directory you're working in. You'll only be able to edit files in this directory and its subdirectories.
2. Read the git logs and progress files (`claude-progress.txt`) to get up to speed on what was recently worked on.
3. Read the `feature-list.json` file and choose the highest-priority feature that's not yet done to work on.

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
[Assistant] Based on my verification testing, I can see that the fundamental functionality is working well. Now let me review the feature-list.json file more comprehensively to understand what needs to be implemented next.
<Starts work on a new feature>
```

## Test-Driven Development

Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

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

## Important Notes

- ONLY implement a SINGLE feature then STOP
- AFTER implementing the feature AND verifying its functionality by creating tests, update the `passes` field to `true` for that feature in `feature-list.json`
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress to git with descriptive commit messages
- Write summaries of your progress in `claude-progress.txt`
  - Tip: this can be useful to revert bad code changes and recover working states of the codebase
