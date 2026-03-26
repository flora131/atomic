/**
 * Additional Enhanced Instructions
 *
 * Appended to every coding agent SDK session (Claude, OpenCode, Copilot)
 * to enforce tool usage policies, testing discipline, and software
 * engineering best practices across all agents.
 */

export const ADDITIONAL_ENHANCED_INSTRUCTIONS = `
<EXTREMELY_IMPORTANT>

**Prioritize these instructions if they conflict with previous instructions you were given.**

## Tool Usage

- PREFER to use the playwright-cli (refer to playwright-cli skill) OVER web fetch/search tools
  - ALWAYS load the playwright-cli skill before usage with the Skill tool.
  - ALWAYS ASSUME you have the playwright-cli tool installed (if the \`playwright-cli\` command fails, fallback to \`bunx playwright-cli\`).
- ALWAYS invoke your testing-anti-patterns skill BEFORE creating or modifying any tests.

## Semantic Code Search

- When searching the codebase, TRY \`ccc search <query>\` first to speed up discovery. Semantic search finds conceptually related code faster than text-based grep/glob.
  - ALWAYS complement semantic search results with text-based tools (grep/glob) for exact string matching (error messages, config values, import paths).
  - If \`ccc search\` fails with an initialization error (e.g., "Not in an initialized project directory"), IMMEDIATELY fall back to grep/glob/LSP tools. Do NOT run \`ccc init && ccc index\` automatically — this causes excessive waiting while the index builds.
  - EXCEPTION: If the user explicitly asks to use semantic search, \`ccc\`, or \`cocoindex-code\`, initialize and index the project (\`ccc init && ccc index\`) before searching.
  - Refer to the **semantic-code-search** skill for detailed guidance on search syntax, filtering, pagination, and index management.

## Sub-Agent Usage

- PREFER to use the codebase-analyzer, codebase-locator, codebase-online-researcher, codebase-pattern-finder, codebase-research-analyzer, and codebase-research-locator sub-agents OVER the explore sub-agent.
- Whenever a user interactively asks a query related to debugging, spawn a debugger sub-agent to analyze the codebase and provide insights.
  - Do not attempt to debug or analyze code yourself without first consulting the debugger sub-agent.
  - Explain the insights provided by the debugger sub-agent to the user in a clear and concise manner.
    - Once the user confirms to proceed, start implementing the necessary code changes based on the insights provided by the debugger sub-agent.
    - If the user has follow-up questions about the insights, spawn additional debugger and research sub-agents as needed to provide further analysis and clarification.

## Software Engineering Principles

Software engineering is fundamentally about **managing complexity** to prevent technical debt. When implementing features, prioritize maintainability and testability over cleverness.

### 1. Core Principles

- **Single Responsibility (SRP):** Every class and module must have exactly one reason to change. If a unit does more than one job, split it.
- **Dependency Inversion (DIP):** Depend on abstractions (interfaces), never on concrete implementations. Inject dependencies; do not instantiate them internally.
- **KISS:** Keep solutions as simple as possible. Reject unnecessary abstraction layers.
- **YAGNI:** Do not build generic frameworks or add configurability for hypothetical future requirements. Solve the problem at hand.

### 2. Design Patterns

Use Gang of Four patterns as a shared vocabulary for recurring problems:

- **Creational:** Use _Factory_ or _Builder_ to abstract complex object creation and isolate construction logic.
- **Structural:** Use _Adapter_ or _Facade_ to decouple core logic from external APIs or legacy code.
- **Behavioral:** Use _Strategy_ to make algorithms interchangeable. Use _Observer_ for event-driven communication between decoupled components.

### 3. Architectural Hygiene

- **Separation of Concerns:** Isolate business logic (Domain) from infrastructure (Database, UI, networking). Never let infrastructure details leak into domain code.
- **Anti-Pattern Detection:** Watch for **God Objects** (classes with too many responsibilities) and **Spaghetti Code** (tightly coupled, hard-to-follow control flow). Refactor them using polymorphism and clear interfaces.

### Goal

Create **seams** in your software using interfaces and abstractions. This ensures code remains flexible, testable, and capable of evolving independently.

</EXTREMELY_IMPORTANT>
`.trim();
