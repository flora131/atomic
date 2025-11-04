# Project Overview

<!--
  TEMPLATE INSTRUCTIONS: Replace this section with your project's description.
  Include information about:
  - What your project does
  - Main technologies used (framework, language, etc.)
  - Key features or goals
  - Target users or use cases
-->

[YOUR_PROJECT_DESCRIPTION]

**Example**: This is a [YOUR_FRAMEWORK]/[YOUR_LANGUAGE] project that [YOUR_PROJECT_PURPOSE].

# MANDATORY FIRST RESPONSE PROTOCOL

Before responding to ANY user message, you MUST complete this checklist:

1. ☐ List available skills in your mind
2. ☐ Ask yourself: "Does ANY skill match this request?"
3. ☐ If yes → Use the Skill tool to read and run the skill file
4. ☐ Announce which skill you're using
5. ☐ Follow the skill exactly

**Responding WITHOUT completing this checklist = automatic failure.**

## Common Rationalizations That Mean You're About To Fail

If you catch yourself thinking ANY of these thoughts, STOP. You are rationalizing. Check for and use the skill.

- "This is just a simple question" → WRONG. Questions are tasks. Check for skills.
- "I can check git/files quickly" → WRONG. Files don't have conversation context. Check for skills.
- "Let me gather information first" → WRONG. Skills tell you HOW to gather information. Check for skills.
- "This doesn't need a formal skill" → WRONG. If a skill exists for it, use it.
- "I remember this skill" → WRONG. Skills evolve. Run the current version.
- "This doesn't count as a task" → WRONG. If you're taking action, it's a task. Check for skills.
- "The skill is overkill for this" → WRONG. Skills exist because simple things become complex. Use it.
- "I'll just do this one thing first" → WRONG. Check for skills BEFORE doing anything.

**Why:** Skills document proven techniques that save time and prevent mistakes. Not using available skills means repeating solved problems and making known errors.

If a skill for your task exists, you must use it or you will fail at your task.

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in `specs/PLANS.md`) from design to implementation. If the user request requires multiple specs, create multiple specification files in the `specs/` directory. After creating the specs, create a master ExecPlan that links to each individual spec ExecPlan. Update the `specs/README.md` to include links to the new specs.

ALWAYS start an ExecPlan creation by consulting the DeepWiki tool for best practices on design patterns, architecture, and implementation strategies. Ask it questions about the system design and constructs in the library that will help you achieve your goals.

Skip using an ExecPlan for straightforward tasks (roughly the easiest 25%).

# Architecture

<!--
  TEMPLATE INSTRUCTIONS: Describe your project's file/folder structure here.
  Include information about:
  - Where different types of files live
  - Routing structure (if applicable)
  - Component organization
  - Asset management
-->

[YOUR_ARCHITECTURE_DESCRIPTION]

**Example directory structure:**
- Route handlers in `[YOUR_ROUTES_DIR]/`
- Components in `[YOUR_COMPONENTS_DIR]/`
- Utilities in `[YOUR_UTILS_DIR]/`
- Styles in `[YOUR_STYLES_DIR]/`
- Static assets in `[YOUR_ASSETS_DIR]/`
- Tests in `[YOUR_TESTS_DIR]/`

## Technology Stack Focus

<!--
  TEMPLATE INSTRUCTIONS: List your project's main technologies and frameworks.
-->

* **[FRAMEWORK]**: [Key features you're using]
* **[UI_LIBRARY]**: [Purpose]
* **[LANGUAGE]**: [Version and key features]
* **[STYLING_SOLUTION]**: [Approach]
* **[STATE_MANAGEMENT]**: [If applicable]

# Development Guidelines

## General

- Before implementing a large refactor or new feature explain your plan and get approval.
- Human-in-the-loop: If you're unsure about a design decision or implementation detail, ask for clarification before proceeding. Feel free to ask clarifying questions as you are working.
- Avoid re-inventing the wheel: Use existing libraries and tools where appropriate (e.g., component libraries like `shadcn/ui`, css frameworks like `tailwindcss`).

## Package Management

<!--
  TEMPLATE INSTRUCTIONS: Replace with your package manager and common commands.
  Examples: npm, yarn, pnpm, bun
-->

This project uses `[YOUR_PACKAGE_MANAGER]` as the package manager. Below are common commands you'll use:

- `[INSTALL_COMMAND]` - Install dependencies
- `[TEST_COMMAND]` - Run tests
- `[LINT_COMMAND]` - Run linting
- `[BUILD_COMMAND]` - Build the project
- `[DEV_COMMAND]` - Start the development server
- `[START_COMMAND]` - Start the production server
- `[ADD_PACKAGE_COMMAND]` - Add a dependency
- `[REMOVE_PACKAGE_COMMAND]` - Remove a dependency

# Code Style

<!--
  TEMPLATE INSTRUCTIONS: Customize code style guidelines for your project.
  Include:
  - Type safety requirements
  - Component patterns
  - Data validation approach
  - Code formatting tools
  - Linting rules
  - Framework-specific best practices
-->

## General Code Style

- Never use `any` type (if using TypeScript)--always use proper types and interfaces
- [YOUR_COMPONENT_PATTERN] (e.g., prefer function components over class components)
- Always validate external data with `[YOUR_VALIDATION_LIBRARY]`
- Use `[YOUR_FORMATTER]` for code formatting
- Use `[YOUR_LINTER]` for linting and follow its recommendations
- Follow accessibility best practices (e.g., proper use of ARIA attributes, semantic HTML)

## Component Patterns

<!--
  TEMPLATE INSTRUCTIONS: Provide an example component following your project's conventions.
-->

Use [YOUR_COMPONENT_PATTERN] with proper type definitions:

```[YOUR_LANGUAGE]
// Example component following your project's patterns
[YOUR_EXAMPLE_COMPONENT_CODE]
```

## Data Fetching

<!--
  TEMPLATE INSTRUCTIONS: Describe your data fetching strategy.
  Examples: GraphQL, REST, Server Components, etc.
-->

[YOUR_DATA_FETCHING_STRATEGY]

## Validation

<!--
  TEMPLATE INSTRUCTIONS: Describe how external data should be validated.
-->

Always validate external data using `[YOUR_VALIDATION_LIBRARY]`.

## Routing

<!--
  TEMPLATE INSTRUCTIONS: Describe your routing structure and conventions.
-->

[YOUR_ROUTING_CONVENTIONS]

## UI Components

<!--
  TEMPLATE INSTRUCTIONS: Describe your component library and styling approach.
-->

Use `[YOUR_COMPONENT_LIBRARY]` for UI components:

```[YOUR_LANGUAGE]
// Example UI component usage
[YOUR_EXAMPLE_UI_CODE]
```

## Accessibility

Use semantic HTML first. Only add ARIA when no semantic equivalent exists.

## Import Standards

<!--
  TEMPLATE INSTRUCTIONS: Define import path conventions (absolute vs relative, aliases, etc.)
-->

Use `[YOUR_IMPORT_ALIAS]` for all internal imports:

```[YOUR_LANGUAGE]
// ✅ Good
import { Component } from '[YOUR_IMPORT_PATTERN]'

// ❌ Bad
import { Component } from '[ANTI_PATTERN]'
```

## Common Patterns

- [YOUR_PATTERN_1]
- [YOUR_PATTERN_2]
- [YOUR_PATTERN_3]

# Test-Driven Development (TDD)

- Never create throwaway test scripts or ad hoc verification files
- If you need to test functionality, write a proper test in the test suite

<!--
  TEMPLATE INSTRUCTIONS: Specify your testing tools and approach.
  Include:
  - Unit test framework
  - Integration test framework
  - E2E test framework
  - Testing best practices
-->

## Testing Frameworks

- Use `[YOUR_UNIT_TEST_FRAMEWORK]` for unit, component, and integration tests
- Use `[YOUR_E2E_TEST_FRAMEWORK]` for end-to-end and snapshot tests

# Tools

<!--
  TEMPLATE INSTRUCTIONS: List any MCP tools, custom scripts, or development tools available to the agent.
  This section helps the AI agent understand what additional capabilities it has access to.
  Common categories:
  - Sequential thinking/reasoning tools
  - Documentation lookup tools
  - UI component generation tools
  - Browser automation/testing tools
  - Code generation tools
  - Project-specific utilities
-->

You have a collection of tools available to assist with development and debugging. These tools can be invoked as needed.

- `[TOOL_NAME_1]`
  - **When to use:** [Description of when this tool should be used]
- `[TOOL_NAME_2]`
  - **When to use:** [Description of when this tool should be used]
- `[TOOL_NAME_3]`
  - **When to use:** [Description of when this tool should be used]

# Updates to This Document
- Update this document as needed to reflect changes in development practices or project structure.
- Do NOT contradict existing guidelines in the document

## Skills
You have skills available.
- List your skills by running the list-skills command with your agent's skills directory:
  - Codex: `list-skills.js ~/.codex/skills`
  - Cursor: `list-skills.js ~/.cursor/skills`
  - Windsurf: `list-skills.js ~/.windsurf/skills`
  - GitHub Copilot: `list-skills.js ~/.github/skills`
- Remember the skill names and descriptions
- If a skill matches a task, read its full SKILL.md and use it
- Announce: "I've read the [Skill Name] skill and I'm using it to [purpose]"
