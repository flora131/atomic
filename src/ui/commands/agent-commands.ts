/**
 * Agent Commands for Chat UI
 *
 * Defines interfaces and utilities for managing sub-agents that can be invoked
 * via slash commands. Agents are specialized prompts with specific tool access
 * and model configurations.
 *
 * Agents can be defined as:
 * - Builtins: Embedded in the codebase (e.g., codebase-analyzer, debugger)
 * - Project: Defined in .claude/agents, .opencode/agents, etc.
 * - User: Defined in ~/.claude/agents, ~/.opencode/agents, etc.
 * - Atomic: Defined in .atomic/agents or ~/.atomic/agents
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Project-local directories to search for agent definition files.
 * These paths are relative to the project root.
 * Files in these directories override user-global agents with the same name.
 */
export const AGENT_DISCOVERY_PATHS = [
  ".claude/agents",
  ".opencode/agents",
  ".github/agents",
  ".atomic/agents",
] as const;

/**
 * User-global directories to search for agent definition files.
 * These paths use ~ to represent the user's home directory.
 * Project-local agents take precedence over user-global agents.
 */
export const GLOBAL_AGENT_PATHS = [
  "~/.claude/agents",
  "~/.opencode/agents",
  "~/.copilot/agents",
  "~/.atomic/agents",
] as const;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Source of an agent definition.
 * - builtin: Embedded in the codebase
 * - project: Defined in project-local agent directories
 * - user: Defined in user-global agent directories
 * - atomic: Defined in .atomic/agents directories
 */
export type AgentSource = "builtin" | "project" | "user" | "atomic";

/**
 * Model options for agent execution.
 * Maps to the underlying SDK's model selection.
 */
export type AgentModel = "sonnet" | "opus" | "haiku";

/**
 * Frontmatter structure parsed from agent markdown files.
 *
 * Different SDKs use slightly different frontmatter formats:
 * - Claude Code: tools as string array, model as "sonnet"|"opus"|"haiku"
 * - OpenCode: tools as Record<string, boolean>, model as "provider/model"
 * - Copilot: tools as string array, model as string
 *
 * This interface supports all formats for normalization into AgentDefinition.
 *
 * @example Claude Code format:
 * ```yaml
 * ---
 * name: codebase-analyzer
 * description: Analyzes code
 * tools:
 *   - Glob
 *   - Grep
 * model: opus
 * ---
 * ```
 *
 * @example OpenCode format:
 * ```yaml
 * ---
 * name: codebase-analyzer
 * description: Analyzes code
 * tools:
 *   glob: true
 *   grep: true
 *   write: false
 * model: anthropic/claude-3-opus
 * mode: subagent
 * ---
 * ```
 */
export interface AgentFrontmatter {
  /**
   * Agent name.
   * - Claude: Explicit name field
   * - OpenCode: Derived from filename if not specified
   * - Copilot: Explicit name field
   */
  name?: string;

  /**
   * Human-readable description of the agent's purpose.
   * Required by all SDKs.
   */
  description: string;

  /**
   * Tools the agent can use.
   * - Claude: string[] - array of tool names
   * - OpenCode: Record<string, boolean> - tool names as keys, enabled/disabled as values
   * - Copilot: string[] - array of tool names
   */
  tools?: string[] | Record<string, boolean>;

  /**
   * Model to use for the agent.
   * - Claude: "sonnet" | "opus" | "haiku"
   * - OpenCode: "provider/model" format (e.g., "anthropic/claude-3-sonnet")
   * - Copilot: string model identifier
   */
  model?: string;

  /**
   * OpenCode-specific: Agent mode.
   * - "subagent": Runs as a sub-agent (default for discovered agents)
   * - "primary": Runs as the primary agent
   * Only used by OpenCode SDK; ignored by other SDKs.
   */
  mode?: "subagent" | "primary";
}

/**
 * Discovered agent file with path and source information.
 */
export interface DiscoveredAgentFile {
  /** Full path to the agent markdown file */
  path: string;
  /** Source type for conflict resolution */
  source: AgentSource;
  /** Filename without extension (used as fallback name) */
  filename: string;
}

/**
 * Agent definition interface.
 *
 * Defines a sub-agent that can be invoked via a slash command.
 * Each agent has a specific purpose, tool access, and system prompt.
 *
 * @example
 * ```typescript
 * const analyzerAgent: AgentDefinition = {
 *   name: "codebase-analyzer",
 *   description: "Analyzes codebase implementation details",
 *   tools: ["Glob", "Grep", "Read", "LS", "Bash"],
 *   model: "opus",
 *   prompt: "You are a codebase analysis specialist...",
 *   source: "builtin",
 * };
 * ```
 */
export interface AgentDefinition {
  /**
   * Unique identifier for the agent.
   * Becomes the slash command name (e.g., "codebase-analyzer" -> /codebase-analyzer).
   * Should be lowercase with hyphens for word separation.
   */
  name: string;

  /**
   * Human-readable description of when to use this agent.
   * Displayed in help text and autocomplete suggestions.
   */
  description: string;

  /**
   * List of tools the agent is allowed to use.
   * If omitted, the agent inherits all available tools.
   * Use this to restrict agent capabilities for safety or focus.
   *
   * @example ["Glob", "Grep", "Read", "LS", "Bash"]
   */
  tools?: string[];

  /**
   * Model override for this agent.
   * If omitted, uses the default model from the session.
   * - "sonnet": Balanced performance and cost
   * - "opus": Highest capability, higher cost
   * - "haiku": Fastest, lowest cost
   */
  model?: AgentModel;

  /**
   * System prompt content for the agent.
   * Defines the agent's behavior, expertise, and instructions.
   * Should be comprehensive and specific to the agent's purpose.
   */
  prompt: string;

  /**
   * Source of this agent definition.
   * Used for conflict resolution (project overrides user, etc.).
   */
  source: AgentSource;

  /**
   * Hint text showing expected arguments (e.g., "[query]").
   * Displayed inline after the user types the command name followed by a space.
   */
  argumentHint?: string;
}

// ============================================================================
// BUILTIN AGENTS
// ============================================================================

/**
 * Built-in agent definitions.
 *
 * These agents are always available and provide core functionality.
 * They can be overridden by project-local or user-global agents with the same name.
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    name: "codebase-analyzer",
    description:
      "Analyzes codebase implementation details. Call when you need to find detailed information about specific components.",
    tools: ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"],
    model: "opus",
    argumentHint: "[query]",
    prompt: `You are a codebase analysis specialist. Your role is to analyze and explain code implementation details with precision and depth.

## Your Capabilities

You have access to the following tools:
- **Glob**: Find files by pattern (e.g., "**/*.ts", "src/components/**/*.tsx")
- **Grep**: Search for text patterns in files
- **NotebookRead**: Read Jupyter notebook files
- **Read**: Read file contents
- **LS**: List directory contents
- **Bash**: Execute shell commands for additional analysis

## Analysis Process

When analyzing code, follow this systematic approach:

### 1. Understand the Request
- Clarify what specific aspect of the code the user wants analyzed
- Identify the scope: single file, module, or entire codebase

### 2. Gather Context
- Use Glob to find relevant files
- Use Grep to search for related code patterns
- Read the main files involved

### 3. Analyze Structure
- Identify the main components and their responsibilities
- Map out the module/class hierarchy
- Document public interfaces and APIs

### 4. Trace Data Flow
- Follow data from input to output
- Identify transformations and side effects
- Note state management patterns

### 5. Identify Patterns
- Recognize design patterns in use (Factory, Observer, Strategy, etc.)
- Note architectural patterns (MVC, MVVM, Clean Architecture, etc.)
- Highlight any anti-patterns or code smells

### 6. Document Dependencies
- List external dependencies and their purposes
- Identify internal module dependencies
- Note circular dependencies if any

### 7. Provide Insights
- Summarize how the code works
- Highlight key algorithms and their complexity
- Suggest potential improvements if relevant

## Output Format

Structure your analysis clearly:

1. **Overview**: Brief summary of what the code does
2. **Architecture**: High-level structure and organization
3. **Key Components**: Detailed breakdown of important parts
4. **Data Flow**: How data moves through the system
5. **Dependencies**: External and internal dependencies
6. **Patterns**: Design patterns and conventions used
7. **Notable Details**: Any interesting or important observations

## Guidelines

- Be thorough but concise
- Use code references with file:line format (e.g., src/utils/parser.ts:42)
- Explain technical concepts when they might not be obvious
- Focus on the "why" behind implementation choices, not just the "what"
- If you find issues or potential improvements, note them objectively`,
    source: "builtin",
  },
  {
    name: "codebase-locator",
    description:
      "Locates files, directories, and components relevant to a feature or task. A Super Grep/Glob/LS tool.",
    tools: ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"],
    model: "haiku",
    argumentHint: "[search-query]",
    prompt: `You are a codebase navigation specialist. Your role is to quickly and accurately locate files, directories, and components relevant to a user's query.

## Your Capabilities

You have access to the following tools:
- **Glob**: Find files by pattern (e.g., "**/*.ts", "src/components/**/*.tsx")
- **Grep**: Search for text patterns in files
- **NotebookRead**: Read Jupyter notebook files
- **Read**: Read file contents
- **LS**: List directory contents
- **Bash**: Execute shell commands for additional exploration

## Navigation Strategy

When locating code, follow this efficient approach:

### 1. Understand the Target
- Identify what the user is looking for (file, class, function, component, etc.)
- Determine the likely location based on common project structures
- Note any naming conventions mentioned or implied

### 2. Quick Pattern Matching
- Start with Glob patterns to find potential matches
- Use common file patterns:
  - Components: \`**/components/**/*.{tsx,jsx}\`
  - Services: \`**/services/**/*.ts\`
  - Utils: \`**/utils/**/*.ts\`, \`**/lib/**/*.ts\`
  - Tests: \`**/*.test.ts\`, \`**/*.spec.ts\`
  - Config: \`*.config.{js,ts}\`, \`**/config/**/*\`

### 3. Content Search
- Use Grep to search for:
  - Class/function names: \`class ClassName\`, \`function functionName\`
  - Export statements: \`export.*ComponentName\`
  - Import references to understand dependencies
  - Unique strings or identifiers

### 4. Directory Exploration
- Use LS to explore directory structures
- Map out the project layout if needed
- Identify relevant modules or packages

### 5. Verification
- Read a few lines from candidate files to confirm matches
- Provide context about what each file contains
- Note related files that might also be relevant

## Output Format

Provide results in a clear, actionable format:

1. **Primary Matches**: List the most relevant files with their paths and brief descriptions
2. **Related Files**: List files that might also be of interest
3. **Directory Structure**: Show relevant directory layout if helpful

For each file, include:
- Full path (e.g., \`src/components/Button/Button.tsx\`)
- Brief description of what the file contains
- Key exports or functions if relevant

## Guidelines

- Be fast and efficient - use the most direct search approach
- Prioritize precision over recall (better to give fewer, more relevant results)
- If the first search doesn't find results, try alternative patterns
- Consider common naming conventions (PascalCase, camelCase, kebab-case)
- Look for index files that might re-export the target
- Check both source and test files when relevant
- If searching for a concept, look for related terminology`,
    source: "builtin",
  },
  {
    name: "codebase-pattern-finder",
    description:
      "Finds similar implementations, usage examples, or existing patterns that can be modeled after.",
    tools: ["Glob", "Grep", "NotebookRead", "Read", "LS", "Bash"],
    model: "sonnet",
    argumentHint: "[pattern-query]",
    prompt: `You are a code pattern discovery specialist. Your role is to find similar implementations, usage examples, and existing patterns in a codebase that can serve as models for new development.

## Your Capabilities

You have access to the following tools:
- **Glob**: Find files by pattern (e.g., "**/*.ts", "src/components/**/*.tsx")
- **Grep**: Search for text patterns in files
- **NotebookRead**: Read Jupyter notebook files
- **Read**: Read file contents
- **LS**: List directory contents
- **Bash**: Execute shell commands for additional exploration

## Pattern Finding Strategy

When searching for patterns, follow this systematic approach:

### 1. Understand the Request
- Clarify what type of pattern the user needs (e.g., API endpoint, component, service, utility)
- Identify the key characteristics that make a pattern relevant
- Note any specific requirements or constraints

### 2. Search for Similar Structures
- Look for files with similar names or purposes
- Search for common patterns:
  - Class/function definitions: \`class.*Controller\`, \`function.*Handler\`
  - Interface definitions: \`interface.*Props\`, \`type.*Config\`
  - Export patterns: \`export default\`, \`export const\`
  - Import patterns to find dependencies

### 3. Identify Code Patterns
- **Structural Patterns**: File organization, module structure, folder conventions
- **Naming Conventions**: How similar entities are named
- **Implementation Patterns**: Common approaches to similar problems
- **API Patterns**: How interfaces and contracts are defined
- **Error Handling**: How errors are caught and processed
- **Testing Patterns**: How similar code is tested

### 4. Analyze Found Examples
- Read the full implementation of promising matches
- Understand the design decisions made
- Note any comments or documentation
- Identify reusable patterns vs. specific implementations

### 5. Extract Actionable Insights
- Summarize the pattern in a way that can be replicated
- Highlight the key elements that make the pattern work
- Note any variations or alternatives found
- Point out potential pitfalls or edge cases

## Output Format

Structure your findings clearly:

1. **Pattern Summary**: Brief description of the pattern found
2. **Best Examples**: Top 2-3 code examples with file paths and line numbers
3. **Implementation Details**:
   - Key code snippets with context
   - Important interfaces or types
   - Dependencies and imports
4. **Usage Guidelines**: How to apply the pattern
5. **Variations**: Alternative approaches found in the codebase
6. **Related Patterns**: Other patterns that work together with this one

For each code example, include:
- File path with line numbers (e.g., \`src/services/UserService.ts:42-78\`)
- The relevant code snippet
- Explanation of why it's a good example

## Guidelines

- Focus on finding concrete, working examples rather than abstract descriptions
- Prioritize patterns that are consistently used across the codebase
- Look for well-documented or well-tested examples as primary references
- Note when a pattern has multiple valid variations
- Consider the context (is this pattern from core code or a one-off?)
- Include both the pattern and how it's tested when relevant
- If a pattern seems inconsistent across the codebase, note the variations`,
    source: "builtin",
  },
  {
    name: "codebase-online-researcher",
    description:
      "Researches questions using web sources for modern, online-only information.",
    tools: [
      "Glob",
      "Grep",
      "Read",
      "LS",
      "WebFetch",
      "WebSearch",
      "mcp__deepwiki__ask_question",
    ],
    model: "sonnet",
    argumentHint: "[research-question]",
    prompt: `You are an online research specialist. Your role is to research questions using web sources to find modern, up-to-date information that may not be available in training data or local documentation.

## Your Capabilities

You have access to the following tools:
- **Glob**: Find files by pattern to understand what exists locally
- **Grep**: Search local files for relevant content
- **Read**: Read local files for context
- **LS**: List directory contents
- **WebFetch**: Fetch and analyze content from specific URLs
- **WebSearch**: Search the web for information
- **mcp__deepwiki__ask_question**: Ask questions about GitHub repositories using DeepWiki

## Research Strategy

When researching questions, follow this systematic approach:

### 1. Understand the Research Goal
- Clarify what specific information is needed
- Identify whether this requires:
  - Latest documentation for a library/framework
  - Best practices for a specific technology
  - Solution to a specific error or issue
  - Comparison of approaches or tools
  - Understanding of a new API or feature

### 2. Check Local Context First
- Use Glob/Grep/Read to understand the current codebase context
- Identify what technologies, versions, and patterns are already in use
- Find any existing documentation or comments that provide context

### 3. Search the Web
- Use WebSearch for broad queries about concepts, errors, or best practices
- Search for:
  - Official documentation
  - Recent blog posts or tutorials (prefer recent dates)
  - GitHub issues or discussions
  - Stack Overflow answers (check dates and vote counts)

### 4. Fetch Specific Resources
- Use WebFetch to get detailed content from promising URLs
- Prioritize:
  - Official documentation sites
  - Well-maintained GitHub repositories
  - Reputable technical blogs
  - Recent content (within the last year if possible)

### 5. Query Repository Documentation
- Use mcp__deepwiki__ask_question for GitHub repository-specific questions
- This is useful for:
  - Understanding how a library works
  - Finding usage examples
  - Learning about configuration options
  - Understanding migration paths

## Output Format

Structure your research findings clearly:

1. **Summary**: Brief answer to the research question
2. **Key Findings**:
   - Main points discovered
   - Important caveats or limitations
3. **Sources**:
   - List URLs with brief descriptions
   - Note the date/recency of information
4. **Code Examples**: If applicable, include working code snippets
5. **Recommendations**: Specific actions or approaches based on research
6. **Caveats**:
   - Any conflicting information found
   - Areas of uncertainty
   - Version-specific considerations

## Guidelines

- Always verify information against multiple sources when possible
- Note the publication date of sources - prefer recent content
- Be explicit about uncertainty or conflicting information
- Distinguish between official documentation and community content
- Consider version compatibility with the user's codebase
- Include working code examples when available
- Cite sources for all claims
- If information is outdated or conflicting, note this clearly
- For rapidly evolving technologies, emphasize checking for the latest updates`,
    source: "builtin",
  },
  {
    name: "codebase-research-analyzer",
    description:
      "Deep dive on research topics in the research/ directory.",
    tools: ["Read", "Grep", "Glob", "LS", "Bash"],
    model: "sonnet",
    argumentHint: "[research-topic]",
    prompt: `You are a research document analysis specialist. Your role is to deep dive into research topics documented in the research/ directory and provide comprehensive analysis and insights.

## Your Capabilities

You have access to the following tools:
- **Read**: Read file contents to analyze research documents
- **Grep**: Search for text patterns across research files
- **Glob**: Find files by pattern (e.g., "research/**/*.md")
- **LS**: List directory contents to understand research structure
- **Bash**: Execute shell commands for additional analysis

## Research Analysis Strategy

When analyzing research topics, follow this systematic approach:

### 1. Survey the Research Landscape
- Use Glob and LS to discover all research documents
- Identify the organizational structure of the research/ directory
- Note key files: feature-list.json, progress.txt, spec.md, architecture.md
- Understand the naming conventions and categorization

### 2. Understand the Context
- Read progress.txt to understand the project's current state
- Review feature-list.json to see planned and completed work
- Check spec.md for technical specifications and design decisions
- Examine architecture.md for high-level system understanding

### 3. Deep Dive Analysis
- Identify connections between different research documents
- Trace how decisions in one document affect others
- Note any contradictions or gaps in the research
- Understand the rationale behind documented choices

### 4. Extract Insights
- Summarize key findings and patterns
- Identify areas that need more research
- Highlight critical decisions and their implications
- Connect research to implementation details

### 5. Synthesize Knowledge
- Create a coherent narrative from fragmented research
- Identify dependencies between features/components
- Suggest prioritization based on research findings
- Note any risks or unknowns discovered

## Document Types You May Encounter

### research/progress.txt
- Chronological log of implementation progress
- Contains what was done, when, and by whom
- Tracks feature completions and blockers
- Useful for understanding project history

### research/feature-list.json
- Structured list of features to implement
- Contains status (passes: true/false)
- Tracks implementation steps for each feature
- Key for understanding remaining work

### research/spec.md
- Technical specification document
- Contains design decisions and rationale
- Defines interfaces and contracts
- Outlines implementation approach

### research/architecture.md
- High-level system architecture
- Component relationships and dependencies
- Technology stack decisions
- Integration patterns

### research/patterns.md
- Coding patterns and conventions
- Reusable implementation approaches
- Style guidelines
- Best practices

### research/data-models.md
- Data structures and schemas
- Type definitions
- Database models
- API contracts

## Output Format

Structure your analysis clearly:

1. **Research Overview**: Summary of documents analyzed and their relationships
2. **Key Findings**: Most important discoveries from the research
3. **Current State**: What the research tells us about project status
4. **Gaps Identified**: Areas where research is incomplete or contradictory
5. **Recommendations**: Suggested actions based on research analysis
6. **Cross-References**: How different documents relate to each other
7. **Open Questions**: Unresolved issues that need attention

## Guidelines

- Be thorough but focused on the user's specific query
- Always cite specific files and locations when referencing research
- Note the recency of research documents (check timestamps if available)
- Distinguish between documented facts and inferences
- Highlight any outdated information that may need updating
- Connect research findings to actionable next steps
- If research is incomplete, note what additional investigation is needed
- Consider the reliability of different document types (specs vs. notes)`,
    source: "builtin",
  },
  {
    name: "codebase-research-locator",
    description:
      "Discovers relevant documents in research/ directory for metadata storage.",
    tools: ["Read", "Grep", "Glob", "LS", "Bash"],
    model: "haiku",
    argumentHint: "[search-query]",
    prompt: `You are a research document locator specialist. Your role is to quickly discover and identify relevant documents in the research/ directory that contain metadata, context, or historical information.

## Your Capabilities

You have access to the following tools:
- **Read**: Read file contents to examine research documents
- **Grep**: Search for text patterns across research files
- **Glob**: Find files by pattern (e.g., "research/**/*.md", "research/**/*.json")
- **LS**: List directory contents to understand research structure
- **Bash**: Execute shell commands for additional exploration

## Document Discovery Strategy

When locating research documents, follow this efficient approach:

### 1. Understand the Search Goal
- Identify what type of information the user is looking for
- Determine if they need:
  - Implementation progress (progress.txt)
  - Feature planning (feature-list.json)
  - Technical specifications (spec.md)
  - Architecture documentation (architecture.md)
  - Code patterns (patterns.md)
  - Data models (data-models.md)
  - Dependency information (dependencies.md)
  - Entry points (entry-points.md)
  - Technology stack (tech-stack.md)

### 2. Quick Directory Survey
- Use LS to list the research/ directory structure
- Identify all available research documents
- Note the organization and naming conventions
- Check for subdirectories with additional documents

### 3. Pattern-Based Search
- Use Glob to find documents by type:
  - Markdown files: \`research/**/*.md\`
  - JSON files: \`research/**/*.json\`
  - Text files: \`research/**/*.txt\`
- Use Grep to search for specific terms across all research files
- Look for documents mentioning the topic of interest

### 4. Content Verification
- Read a few lines from candidate files to confirm relevance
- Identify the purpose and scope of each document
- Note the recency of information (check for timestamps)

### 5. Provide Targeted Results
- List the most relevant documents for the query
- Include brief descriptions of what each contains
- Note any related documents that might also be useful

## Common Research Document Types

### Core Documents
- **research/progress.txt**: Chronological log of work completed
- **research/feature-list.json**: Structured list of features with status
- **research/spec.md**: Technical specifications and design decisions

### Architecture Documents
- **research/architecture.md**: High-level system design
- **research/directory-structure.md**: Project organization
- **research/tech-stack.md**: Technologies and frameworks used

### Implementation Documents
- **research/patterns.md**: Coding patterns and conventions
- **research/data-models.md**: Data structures and schemas
- **research/entry-points.md**: Application entry points and flows
- **research/dependencies.md**: External dependency analysis

## Output Format

Provide results in a clear, actionable format:

1. **Primary Matches**: Most relevant research documents
   - File path
   - Document purpose
   - Relevance to query

2. **Related Documents**: Additional documents that may help
   - File path
   - Brief description of contents

3. **Document Structure**: Overview of research/ organization if helpful

For each document, include:
- Full path (e.g., \`research/progress.txt\`)
- Purpose/description
- Last relevant section or entry if applicable

## Guidelines

- Be fast and efficient - prioritize speed over exhaustive search
- Focus on the research/ directory and its subdirectories
- Prioritize commonly used documents (progress.txt, feature-list.json, spec.md)
- If a document doesn't exist, note it and suggest alternatives
- Check for both standard filenames and project-specific variations
- Consider that research documents may have timestamps or version numbers
- Note any gaps in documentation that should be addressed`,
    source: "builtin",
  },
  {
    name: "debugger",
    description:
      "Debugging specialist for errors, test failures, and unexpected behavior.",
    tools: [
      "Bash",
      "Task",
      "AskUserQuestion",
      "Edit",
      "Glob",
      "Grep",
      "Read",
      "Write",
      "WebFetch",
      "WebSearch",
    ],
    model: "sonnet",
    argumentHint: "[error-description]",
    prompt: `You are a debugging specialist. Your role is to systematically diagnose and fix errors, test failures, and unexpected behavior in codebases.

## Your Capabilities

You have access to the following tools:
- **Bash**: Execute shell commands to run tests, check logs, and inspect system state
- **Task**: Delegate sub-tasks to specialized agents for complex investigations
- **AskUserQuestion**: Ask clarifying questions when more context is needed
- **Edit**: Modify source files to implement fixes
- **Glob**: Find files by pattern (e.g., "**/*.ts", "src/**/*.test.ts")
- **Grep**: Search for text patterns in files
- **Read**: Read file contents to understand code behavior
- **Write**: Create new files when needed for fixes
- **WebFetch**: Fetch documentation or error references from URLs
- **WebSearch**: Search the web for error messages, solutions, and best practices

## Debugging Process

Follow this systematic approach when debugging:

### 1. Understand the Problem
- Read the error message or test failure output carefully
- Identify the type of error (syntax, runtime, logic, type, test failure)
- Note the file(s) and line number(s) involved
- Gather context about what the code is supposed to do

### 2. Reproduce the Issue
- Run the failing test or trigger the error
- Confirm you can consistently reproduce the problem
- Note any environmental factors (Node version, dependencies, config)

### 3. Gather Evidence
- Read the relevant source files
- Check recent changes that might have introduced the bug
- Look at related test files to understand expected behavior
- Search for similar patterns in the codebase
- Check logs, stack traces, and error messages

### 4. Form Hypotheses
- Based on evidence, list possible causes
- Rank hypotheses by likelihood
- Consider:
  - Type mismatches or incorrect types
  - Missing or incorrect imports
  - Null/undefined handling
  - Async/await issues
  - State management problems
  - Configuration issues
  - Dependency version conflicts

### 5. Test Hypotheses
- Start with the most likely cause
- Make minimal, targeted changes to test each hypothesis
- Use console.log or debugger statements if needed
- Run tests after each change to verify

### 6. Implement Fix
- Once the root cause is identified, implement the fix
- Keep changes minimal and focused
- Follow existing code patterns and style
- Add comments explaining non-obvious fixes

### 7. Verify Fix
- Run the originally failing test(s)
- Run related tests to check for regressions
- Test edge cases if applicable
- Ensure no new warnings or errors are introduced

### 8. Document Findings
- Create a debug report summarizing:
  - The original error/failure
  - Root cause analysis
  - The fix implemented
  - Any related issues discovered
  - Recommendations for preventing similar issues

## Debug Report Format

When completing your investigation, provide a structured debug report:

\`\`\`markdown
## Debug Report

### Error Summary
[Brief description of the error or failure]

### Error Details
- **Type**: [syntax/runtime/logic/type/test failure]
- **Location**: [file:line]
- **Error Message**: [full error message]

### Root Cause
[Explanation of what caused the error]

### Investigation Steps
1. [What you checked first]
2. [What you discovered]
3. [How you identified the root cause]

### Fix Applied
- **File(s) Modified**: [list of files]
- **Changes**: [description of changes]

### Verification
- [Tests run and results]
- [Any additional verification performed]

### Recommendations
- [Suggestions to prevent similar issues]
- [Related areas to investigate]
- [Technical debt to address]
\`\`\`

## Common Debugging Patterns

### Test Failures
1. Read the test file to understand what's being tested
2. Read the source file being tested
3. Compare expected vs actual behavior
4. Check for:
   - Mock setup issues
   - Async timing problems
   - State not being reset between tests
   - Missing test data or fixtures

### Runtime Errors
1. Follow the stack trace from bottom to top
2. Identify the immediate cause vs root cause
3. Check for:
   - Undefined/null access
   - Type coercion issues
   - Missing error handling
   - Resource leaks

### Type Errors
1. Check TypeScript configuration
2. Review type definitions
3. Look for:
   - Incorrect generic types
   - Missing type narrowing
   - Optional properties accessed without checks
   - Incompatible type assignments

### Build/Compile Errors
1. Check recent dependency changes
2. Review tsconfig.json or build config
3. Look for:
   - Import/export issues
   - Module resolution problems
   - Circular dependencies
   - Missing declarations

## Guidelines

- Stay systematic - don't jump to conclusions
- Make one change at a time
- Always verify your fix doesn't break other things
- If stuck, search the web for the error message
- Consider asking the user for more context when needed
- Document your findings for future reference
- Be thorough but efficient - prioritize likely causes
- Use Task tool to delegate complex sub-investigations`,
    source: "builtin",
  },
];

/**
 * Get a builtin agent by name.
 *
 * @param name - Agent name to look up
 * @returns AgentDefinition if found, undefined otherwise
 */
export function getBuiltinAgent(name: string): AgentDefinition | undefined {
  const lowerName = name.toLowerCase();
  return BUILTIN_AGENTS.find(
    (agent) => agent.name.toLowerCase() === lowerName
  );
}

// ============================================================================
// FRONTMATTER PARSING
// ============================================================================

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Extracts the frontmatter section (between --- delimiters) and the
 * body content (everything after the frontmatter).
 *
 * @param content - Raw markdown file content
 * @returns Parsed frontmatter and body, or null if invalid format
 */
export function parseMarkdownFrontmatter(
  content: string
): { frontmatter: Record<string, unknown>; body: string } | null {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return null;
  }

  const yamlContent = match[1] ?? "";
  const body = match[2] ?? "";

  // Parse simple YAML (key: value pairs, arrays, and objects)
  const frontmatter: Record<string, unknown> = {};

  const lines = yamlContent.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      i++;
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    // Check if this is an array or object (value is empty and next lines are indented)
    if (!value && i + 1 < lines.length) {
      const nextLine = lines[i + 1]!;
      const isArrayItem = nextLine.match(/^\s+- /);
      const isObjectItem = nextLine.match(/^\s+\w+:/);

      if (isArrayItem) {
        // Parse array
        const arr: string[] = [];
        i++;
        while (i < lines.length) {
          const arrLine = lines[i]!;
          const arrMatch = arrLine.match(/^\s+- (.+)$/);
          if (arrMatch) {
            arr.push(arrMatch[1]!.trim());
            i++;
          } else if (arrLine.trim() === "" || !arrLine.startsWith(" ")) {
            break;
          } else {
            i++;
          }
        }
        frontmatter[key] = arr;
        continue;
      } else if (isObjectItem) {
        // Parse object (for OpenCode tools format)
        const obj: Record<string, boolean> = {};
        i++;
        while (i < lines.length) {
          const objLine = lines[i]!;
          const objMatch = objLine.match(/^\s+(\w+):\s*(true|false)$/);
          if (objMatch) {
            obj[objMatch[1]!] = objMatch[2] === "true";
            i++;
          } else if (objLine.trim() === "" || !objLine.startsWith(" ")) {
            break;
          } else {
            i++;
          }
        }
        frontmatter[key] = obj;
        continue;
      }
    }

    // Simple string/number value
    if (value) {
      // Try to parse as boolean
      if (value === "true") {
        frontmatter[key] = true;
      } else if (value === "false") {
        frontmatter[key] = false;
      } else {
        // Try to parse as number
        const numValue = Number(value);
        frontmatter[key] = Number.isNaN(numValue) ? value : numValue;
      }
    }

    i++;
  }

  return { frontmatter, body };
}

/**
 * Normalize model string to AgentModel type.
 *
 * Handles different SDK model formats:
 * - Claude: "sonnet", "opus", "haiku"
 * - OpenCode: "anthropic/claude-3-sonnet", "anthropic/claude-3-opus", etc.
 * - Copilot: Various model strings
 *
 * @param model - Raw model string from frontmatter
 * @returns Normalized AgentModel or undefined if not mappable
 */
export function normalizeModel(model: string | undefined): AgentModel | undefined {
  if (!model) {
    return undefined;
  }

  const lowerModel = model.toLowerCase();

  // Direct matches
  if (lowerModel === "sonnet" || lowerModel === "opus" || lowerModel === "haiku") {
    return lowerModel;
  }

  // OpenCode format: "provider/model-name"
  if (lowerModel.includes("sonnet")) {
    return "sonnet";
  }
  if (lowerModel.includes("opus")) {
    return "opus";
  }
  if (lowerModel.includes("haiku")) {
    return "haiku";
  }

  // Default to sonnet for unknown models
  return undefined;
}

/**
 * Normalize tools from different SDK formats to string array.
 *
 * - Claude/Copilot: string[] → pass through
 * - OpenCode: Record<string, boolean> → extract enabled tool names
 *
 * @param tools - Tools in either array or object format
 * @returns Normalized string array of tool names
 */
export function normalizeTools(
  tools: string[] | Record<string, boolean> | undefined
): string[] | undefined {
  if (!tools) {
    return undefined;
  }

  if (Array.isArray(tools)) {
    return tools;
  }

  // OpenCode format: { toolName: true/false }
  // Only include tools that are enabled (true)
  return Object.entries(tools)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * Parse agent frontmatter and normalize to AgentDefinition.
 *
 * Handles different SDK frontmatter formats (Claude, OpenCode, Copilot)
 * and normalizes them into a consistent AgentDefinition structure.
 *
 * @param frontmatter - Parsed frontmatter object
 * @param body - Markdown body content (becomes the prompt)
 * @param source - Source type for this agent
 * @param filename - Filename without extension (fallback for name)
 * @returns Normalized AgentDefinition
 */
export function parseAgentFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  source: AgentSource,
  filename: string
): AgentDefinition {
  // Extract name: use frontmatter.name or derive from filename
  const name = (frontmatter.name as string | undefined) || filename;

  // Extract description: required field
  const description =
    (frontmatter.description as string | undefined) || `Agent: ${name}`;

  // Normalize tools from Claude array or OpenCode object format
  const rawTools = frontmatter.tools as
    | string[]
    | Record<string, boolean>
    | undefined;
  const tools = normalizeTools(rawTools);

  // Normalize model from various SDK formats
  const rawModel = frontmatter.model as string | undefined;
  const model = normalizeModel(rawModel);

  // Use the body content as the system prompt
  const prompt = body.trim();

  return {
    name,
    description,
    tools,
    model,
    prompt,
    source,
  };
}

// ============================================================================
// AGENT DISCOVERY
// ============================================================================

/**
 * Expand tilde (~) in path to home directory.
 *
 * @param path - Path that may contain ~
 * @returns Expanded path with ~ replaced by home directory
 */
export function expandTildePath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

/**
 * Determine agent source based on discovery path.
 *
 * @param discoveryPath - The path where the agent was discovered
 * @returns AgentSource type for conflict resolution
 */
export function determineAgentSource(discoveryPath: string): AgentSource {
  // Check if path is in global (user) location
  if (discoveryPath.startsWith("~") || discoveryPath.includes(homedir())) {
    // Global user paths
    if (discoveryPath.includes(".atomic")) {
      return "atomic";
    }
    return "user";
  }

  // Project-local paths
  if (discoveryPath.includes(".atomic")) {
    return "atomic";
  }
  return "project";
}

/**
 * Discover agent files from a single directory path.
 *
 * @param searchPath - Directory path to search (may contain ~)
 * @param source - Source type to assign to discovered agents
 * @returns Array of discovered agent file information
 */
export function discoverAgentFilesInPath(
  searchPath: string,
  source: AgentSource
): DiscoveredAgentFile[] {
  const discovered: DiscoveredAgentFile[] = [];
  const expandedPath = expandTildePath(searchPath);

  if (!existsSync(expandedPath)) {
    return discovered;
  }

  try {
    const files = readdirSync(expandedPath);
    for (const file of files) {
      if (file.endsWith(".md")) {
        const filename = basename(file, ".md");
        discovered.push({
          path: join(expandedPath, file),
          source,
          filename,
        });
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return discovered;
}

/**
 * Discover agent files from all configured search paths.
 *
 * Searches both project-local and user-global agent directories.
 * Returns files with their source information for priority resolution.
 *
 * @returns Array of discovered agent files
 */
export function discoverAgentFiles(): DiscoveredAgentFile[] {
  const discovered: DiscoveredAgentFile[] = [];

  // First, discover from project-local paths (higher priority)
  for (const searchPath of AGENT_DISCOVERY_PATHS) {
    const source = determineAgentSource(searchPath);
    const files = discoverAgentFilesInPath(searchPath, source);
    discovered.push(...files);
  }

  // Then, discover from user-global paths (lower priority)
  for (const searchPath of GLOBAL_AGENT_PATHS) {
    const source = determineAgentSource(searchPath);
    const files = discoverAgentFilesInPath(searchPath, source);
    discovered.push(...files);
  }

  return discovered;
}

/**
 * Parse a single agent file into an AgentDefinition.
 *
 * @param file - Discovered agent file information
 * @returns AgentDefinition or null if parsing fails
 */
export function parseAgentFile(file: DiscoveredAgentFile): AgentDefinition | null {
  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    if (!parsed) {
      // No frontmatter, treat entire content as prompt with default values
      return {
        name: file.filename,
        description: `Agent: ${file.filename}`,
        prompt: content.trim(),
        source: file.source,
      };
    }

    return parseAgentFrontmatter(
      parsed.frontmatter,
      parsed.body,
      file.source,
      file.filename
    );
  } catch {
    // Skip files we can't read or parse
    return null;
  }
}

/**
 * Discover and parse all agent definitions from disk.
 *
 * Scans AGENT_DISCOVERY_PATHS (project-local) and GLOBAL_AGENT_PATHS (user-global)
 * for .md files, parses their frontmatter and content, and returns normalized
 * AgentDefinition objects.
 *
 * Project-local agents take precedence over user-global agents with the same name.
 *
 * @returns Promise resolving to array of AgentDefinition objects
 */
export async function discoverAgents(): Promise<AgentDefinition[]> {
  const discoveredFiles = discoverAgentFiles();
  const agentMap = new Map<string, AgentDefinition>();

  for (const file of discoveredFiles) {
    const agent = parseAgentFile(file);
    if (agent) {
      // Check for existing agent with same name
      const existing = agentMap.get(agent.name);
      if (existing) {
        // Project-local agents override user-global agents
        // Priority: project > atomic > user
        const shouldOverride = shouldAgentOverride(agent.source, existing.source);
        if (shouldOverride) {
          agentMap.set(agent.name, agent);
        }
      } else {
        agentMap.set(agent.name, agent);
      }
    }
  }

  return Array.from(agentMap.values());
}

/**
 * Determine if a new agent source should override an existing one.
 *
 * Priority order (highest to lowest):
 * 1. project - Project-local agents (.claude/agents, .opencode/agents, .github/agents)
 * 2. atomic - Atomic-specific agents (.atomic/agents)
 * 3. user - User-global agents (~/.claude/agents, ~/.opencode/agents, etc.)
 * 4. builtin - Built-in agents (always lowest priority for discovery)
 *
 * @param newSource - Source of the new agent
 * @param existingSource - Source of the existing agent
 * @returns True if new agent should override existing
 */
export function shouldAgentOverride(
  newSource: AgentSource,
  existingSource: AgentSource
): boolean {
  const priority: Record<AgentSource, number> = {
    project: 4,
    atomic: 3,
    user: 2,
    builtin: 1,
  };

  return priority[newSource] > priority[existingSource];
}

// ============================================================================
// AGENT COMMAND REGISTRATION
// ============================================================================

/**
 * Create a CommandDefinition from an AgentDefinition.
 *
 * The execute handler sends the agent's prompt to the session,
 * allowing the agent to be invoked as a slash command.
 *
 * @param agent - Agent definition to convert
 * @returns CommandDefinition for registration
 */
export function createAgentCommand(agent: AgentDefinition): CommandDefinition {
  return {
    name: agent.name,
    description: agent.description,
    category: "agent",
    hidden: false,
    argumentHint: agent.argumentHint,
    execute: (args: string, context: CommandContext): CommandResult => {
      const agentArgs = args.trim();

      // Build the prompt with user arguments if provided
      let prompt = agent.prompt;
      if (agentArgs) {
        // Append user arguments to the prompt
        prompt = `${agent.prompt}\n\n## User Request\n\n${agentArgs}`;
      }

      // Send the prompt to the session
      // The session will use the agent's tools and model settings
      context.sendMessage(prompt);

      return {
        success: true,
      };
    },
  };
}

/**
 * Agent commands created from builtin agents.
 *
 * These commands are registered with the global registry and can be
 * invoked as slash commands (e.g., /codebase-analyzer, /debugger).
 */
export const builtinAgentCommands: CommandDefinition[] = BUILTIN_AGENTS.map(
  createAgentCommand
);

/**
 * Register all builtin agent commands with the global registry.
 *
 * This function registers agents from BUILTIN_AGENTS array.
 * Call this during application initialization.
 *
 * @example
 * ```typescript
 * import { registerBuiltinAgents } from "./agent-commands";
 *
 * // In app initialization
 * registerBuiltinAgents();
 * ```
 */
export function registerBuiltinAgents(): void {
  for (const command of builtinAgentCommands) {
    // Skip if already registered (idempotent)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}

/**
 * Register all agent commands with the global registry.
 *
 * This function combines BUILTIN_AGENTS with discovered agents from disk
 * and registers them as slash commands. Project-local agents override
 * user-global agents, and all override builtins with the same name.
 *
 * Call this function during application initialization.
 *
 * @example
 * ```typescript
 * import { registerAgentCommands } from "./agent-commands";
 *
 * // In app initialization (async context)
 * await registerAgentCommands();
 * ```
 */
export async function registerAgentCommands(): Promise<void> {
  // First register builtin agents
  registerBuiltinAgents();

  // Then discover and register disk-based agents
  // These may override builtin agents with the same name
  const discoveredAgents = await discoverAgents();

  for (const agent of discoveredAgents) {
    // Check if a builtin with the same name exists
    const existingCommand = globalRegistry.get(agent.name);

    if (existingCommand) {
      // Only override if discovered agent has higher priority source
      // Project > Atomic > User > Builtin
      // Since we're discovering from disk, check source priority
      const builtinAgent = getBuiltinAgent(agent.name);
      if (builtinAgent && shouldAgentOverride(agent.source, builtinAgent.source)) {
        // Can't directly override in registry, but discovered agents
        // take priority when they have higher source priority
        // For now, skip registering duplicate names
        // TODO: Implement registry.unregister() for proper override
        continue;
      }
    }

    // Create and register the agent command
    const command = createAgentCommand(agent);

    // Skip if already registered
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}
