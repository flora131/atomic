# Project Overview

<!--
  TEMPLATE INSTRUCTIONS: Replace this section with your project's description.
  Include information about:
  - What your project does
  - Main technologies used
  - Key features or goals
-->

[YOUR_PROJECT_DESCRIPTION]

**Example**: This is a [YOUR_LANGUAGE] project that [YOUR_PROJECT_PURPOSE].

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
  TEMPLATE INSTRUCTIONS: Describe your project's architecture here.
  Include information about:
  - Overall architectural pattern (layered, microservices, etc.)
  - Key components and their responsibilities
  - Package/module structure
  - Design principles
-->

[YOUR_ARCHITECTURE_DESCRIPTION]

**Example architecture structure:**
```
your-project/
├── src/
│   ├── [MODULE_1]/
│   ├── [MODULE_2]/
│   └── [MODULE_3]/
├── tests/
└── [CONFIG_FILES]
```

# Development Guidelines

## General

- Before implementing a large refactor or new feature explain your plan and get approval.
- Human-in-the-loop: If you're unsure about a design decision or implementation detail, ask for clarification before proceeding. Feel free to ask clarifying questions as you are working.
- Avoid re-inventing the wheel: Use existing libraries and tools where appropriate.

<!--
  TEMPLATE INSTRUCTIONS: Replace this section with your project's technology stack and package management instructions.
  Include information about:
  - Programming languages used
  - Package managers (npm, pip, cargo, etc.)
  - Common commands for development
  - Build tools
-->

## [YOUR_PRIMARY_LANGUAGE]

`[YOUR_PACKAGE_MANAGER]` is the command-line tool used to manage the development environment and dependencies. Below are the common commands you'll use:

- `[INSTALL_COMMAND]` - Install/sync dependencies
- `[ADD_PACKAGE_COMMAND]` - Add a dependency
- `[RUN_TESTS_COMMAND]` - Run tests
- `[LINT_COMMAND]` - Run linting/formatting
- `[BUILD_COMMAND]` - Build the project

### Technology Stack Focus
- **[LANGUAGE_VERSION]**: [Description]
- **[FRAMEWORK_1]**: [Purpose]
- **[FRAMEWORK_2]**: [Purpose]

## [YOUR_SECONDARY_LANGUAGE] (if applicable)

`[PACKAGE_MANAGER]` commands:

- `[BUILD_COMMAND]` - Build the project
- `[TEST_COMMAND]` - Run tests
- `[LINT_COMMAND]` - Run linter
- `[FORMAT_COMMAND]` - Format code

### Code Organization and Modularity

**Prefer highly modular code** that separates concerns into distinct modules. This improves:
- **Testability**: Each module can be tested in isolation
- **Reusability**: Modules can be used independently
- **Maintainability**: Changes are localized to specific modules
- **Readability**: Clear separation of concerns makes code easier to understand

**Guidelines**:
- Keep modules focused on a single responsibility
- Use clear module boundaries and minimal public APIs
- Prefer composition over large monolithic modules
- Extract shared functionality into dedicated modules as the codebase grows

# Code Style

## Documentation

**IMPORTANT: Documentation means docstrings and type hints in the code, NOT separate documentation files.**

- You should NOT create any separate documentation pages (README files, markdown docs, etc.)
- The code itself should contain proficient documentation in the form of docstrings and type hints (for Python)
- For Python: Add comprehensive numpy-style docstrings to all functions, classes, and modules
- Type stubs (.pyi files) should have detailed descriptions for all exported functions and classes

**Avoid Over-Documenting:**
- Do NOT document obvious behavior (e.g., a function named `get_name` that returns a name doesn't need extensive documentation)
- Focus documentation on WHY and HOW, not WHAT (the code itself shows what it does)
- Document edge cases, non-obvious behavior, and important constraints
- Skip docstrings for trivial functions where the name and type hints are self-explanatory
- Prioritize documenting public APIs, complex logic, and non-intuitive design decisions

<!--
  TEMPLATE INSTRUCTIONS: Add language-specific code style guidelines here.
  Common sections to include:
  - Documentation standards (docstrings, comments)
  - Naming conventions
  - Type annotations
  - Formatting tools
  - Language-specific best practices
-->

## [YOUR_LANGUAGE] Code Style

### Documentation and Comments

- Write clear and concise comments for each function
- Ensure functions have descriptive names and include type hints/annotations
- Provide documentation following [YOUR_LANGUAGE_CONVENTION]
  - Example: Use JSDoc for JavaScript, docstrings for Python

### Naming Conventions

- **Variables and Functions**: `[YOUR_CONVENTION]` (e.g., camelCase, snake_case)
- **Classes/Types**: `[YOUR_CONVENTION]` (e.g., PascalCase)
- **Constants**: `[YOUR_CONVENTION]` (e.g., UPPER_SNAKE_CASE)

### Additional Language-Specific Guidelines

[YOUR_SPECIFIC_GUIDELINES]

# Test-Driven Development (TDD)

- Never create throwaway test scripts or ad hoc verification files
- If you need to test functionality, write a proper test in the test suite

<!--
  TEMPLATE INSTRUCTIONS: Customize this section with your testing framework and approach.
  Include:
  - Testing framework(s) used
  - Test organization structure
  - Testing best practices for your project
  - Coverage requirements
-->

## Testing Guidelines

- Write tests for all new features in the `[YOUR_TEST_DIRECTORY]/` directory
- Use `[YOUR_TEST_FRAMEWORK]` as the testing framework
- Use `[YOUR_MOCKING_LIBRARY]` for mocking dependencies (if applicable)
- Aim for high test coverage, especially for critical components
- Always include test cases for critical paths of the application
- Account for common edge cases like empty inputs, invalid data types, and large datasets
- Include comments for edge cases and the expected behavior in those cases

# Tools

<!--
  TEMPLATE INSTRUCTIONS: List any MCP tools, custom scripts, or development tools available to the agent.
  This section helps the AI agent understand what additional capabilities it has access to.
  Common categories:
  - Sequential thinking/reasoning tools
  - Documentation lookup tools
  - Code generation tools
  - Testing/debugging tools
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
- Update this document as needed to reflect changes in development practices or project structure
  - Updates usually come in the form of the package structure changing
- Do NOT contradict existing guidelines in the document
- This document should be an executive summary of the development practices for this project
  - Keep low-level implementation details out of this document

## Skills
You have skills available.
- List your skills by running the list-skills command with your agent's skills directory:
  - Codex: `list-skills ~/.codex/skills`
  - Cursor: `list-skills ~/.cursor/skills`
  - Windsurf: `list-skills ~/.windsurf/skills`
  - GitHub Copilot: `list-skills ~/.github/skills`
- Remember the skill names and descriptions
- If a skill matches a task, read its full SKILL.md and use it
- Announce: "I've read the [Skill Name] skill and I'm using it to [purpose]"