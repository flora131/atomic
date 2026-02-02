/**
 * Skill Commands for Chat UI
 *
 * Registers skill commands that invoke predefined skills via session.
 * Skills are specialized prompts/workflows that can be triggered via slash commands.
 *
 * The skill commands load the skill prompt from disk (from agent config directories)
 * and expand $ARGUMENTS with the user's arguments before sending to the agent.
 *
 * Reference: Feature 4 - Implement skill command registration
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Metadata for a skill command definition.
 */
export interface SkillMetadata {
  /** Skill name (without leading slash) - used as command name */
  name: string;
  /** Human-readable description */
  description: string;
  /** Alternative names for the skill */
  aliases?: string[];
  /** Whether this skill is hidden from autocomplete */
  hidden?: boolean;
}

/**
 * Built-in skill definition with embedded prompt content.
 *
 * Unlike SkillMetadata which loads prompts from disk, BuiltinSkill
 * embeds the full prompt content directly, making skills self-contained
 * and not dependent on external files.
 */
export interface BuiltinSkill {
  /** Skill name (without leading slash) - used as command name */
  name: string;
  /** Human-readable description of what the skill does */
  description: string;
  /** Alternative command names for the skill */
  aliases?: string[];
  /** Full prompt content (supports $ARGUMENTS placeholder) */
  prompt: string;
  /** Whether this skill is hidden from autocomplete */
  hidden?: boolean;
}

// ============================================================================
// BUILTIN SKILLS (with embedded prompts)
// ============================================================================

/**
 * Built-in skills with embedded prompt content.
 *
 * These skills are self-contained and don't require external files.
 * They take priority over disk-based skill definitions.
 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "commit",
    description: "Create well-formatted commits with conventional commit format",
    aliases: ["ci"],
    prompt: `# Smart Git Commit

Create well-formatted commit: $ARGUMENTS

## Current Repository State

- Git status: \`git status --porcelain\`
- Current branch: \`git branch --show-current\`
- Staged changes: \`git diff --cached --stat\`
- Unstaged changes: \`git diff --stat\`
- Recent commits: \`git log --oneline -5\`

## What This Command Does

1. Checks which files are staged with \`git status\`
2. If 0 files are staged, automatically adds all modified and new files with \`git add\`
3. Performs a \`git diff\` to understand what changes are being committed
4. Analyzes the diff to determine if multiple distinct logical changes are present
5. If multiple distinct changes are detected, suggests breaking the commit into multiple smaller commits
6. For each commit (or the single commit if not split), creates a commit message using conventional commit format

## Best Practices for Commits

- Follow the Conventional Commits specification as described below.

# Conventional Commits 1.0.0

## Summary

The Conventional Commits specification is a lightweight convention on top of commit messages. It provides an easy set of rules for creating an explicit commit history; which makes it easier to write automated tools on top of. This convention dovetails with [SemVer](http://semver.org), by describing the features, fixes, and breaking changes made in commit messages.

The commit message should be structured as follows:

\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

The commit contains the following structural elements, to communicate intent to the consumers of your library:

1.  **fix:** a commit of the _type_ \`fix\` patches a bug in your codebase (this correlates with [\`PATCH\`](http://semver.org/#summary) in Semantic Versioning).
2.  **feat:** a commit of the _type_ \`feat\` introduces a new feature to the codebase (this correlates with [\`MINOR\`](http://semver.org/#summary) in Semantic Versioning).
3.  **BREAKING CHANGE:** a commit that has a footer \`BREAKING CHANGE:\`, or appends a \`'!'\` after the type/scope, introduces a breaking API change (correlating with [\`MAJOR\`](http://semver.org/#summary) in Semantic Versioning). A BREAKING CHANGE can be part of commits of any _type_.
4.  _types_ other than \`fix:\` and \`feat:\` are allowed, for example [@commitlint/config-conventional](https://github.com/conventional-changelog/commitlint/tree/master/%40commitlint/config-conventional) (based on the [Angular convention](https://github.com/angular/angular/blob/22b96b9/CONTRIBUTING.md#-commit-message-guidelines)) recommends \`build:\`, \`chore:\`, \`ci:\`, \`docs:\`, \`style:\`, \`refactor:\`, \`perf:\`, \`test:\`, and others.
5.  _footers_ other than \`BREAKING CHANGE: <description>\` may be provided and follow a convention similar to [git trailer format](https://git-scm.com/docs/git-interpret-trailers).

Additional types are not mandated by the Conventional Commits specification, and have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE). A scope may be provided to a commit's type, to provide additional contextual information and is contained within parenthesis, e.g., \`feat(parser): add ability to parse arrays\`.

## Examples

### Commit message with description and breaking change footer

\`\`\`
feat: allow provided config object to extend other configs

BREAKING CHANGE: \`extends\` key in config file is now used for extending other config files
\`\`\`

### Commit message with \`'!'\` to draw attention to breaking change

\`\`\`
feat!: send an email to the customer when a product is shipped
\`\`\`

### Commit message with scope and \`'!'\` to draw attention to breaking change

\`\`\`
feat(api)!: send an email to the customer when a product is shipped
\`\`\`

### Commit message with both \`'!'\` and BREAKING CHANGE footer

\`\`\`
chore!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6.
\`\`\`

### Commit message with no body

\`\`\`
docs: correct spelling of CHANGELOG
\`\`\`

### Commit message with scope

\`\`\`
feat(lang): add Polish language
\`\`\`

### Commit message with multi-paragraph body and multiple footers

\`\`\`
fix: prevent racing of requests

Introduce a request id and a reference to latest request. Dismiss
incoming responses other than from latest request.

Remove timeouts which were used to mitigate the racing issue but are
obsolete now.

Reviewed-by: Z
Refs: #123
\`\`\`

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

1.  Commits MUST be prefixed with a type, which consists of a noun, \`feat\`, \`fix\`, etc., followed by the OPTIONAL scope, OPTIONAL \`'!'\`, and REQUIRED terminal colon and space.
2.  The type \`feat\` MUST be used when a commit adds a new feature to your application or library.
3.  The type \`fix\` MUST be used when a commit represents a bug fix for your application.
4.  A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., \`fix(parser):\`
5.  A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes, e.g., _fix: array parsing issue when multiple spaces were contained in string_.
6.  A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
7.  A commit body is free-form and MAY consist of any number of newline separated paragraphs.
8.  One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a \`:<space>\` or \`<space>#\` separator, followed by a string value (this is inspired by the [git trailer convention](https://git-scm.com/docs/git-interpret-trailers)).
9.  A footer's token MUST use \`-\` in place of whitespace characters, e.g., \`Acked-by\` (this helps differentiate the footer section from a multi-paragraph body). An exception is made for \`BREAKING CHANGE\`, which MAY also be used as a token.
10. A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.
11. Breaking changes MUST be indicated in the type/scope prefix of a commit, or as an entry in the footer.
12. If included as a footer, a breaking change MUST consist of the uppercase text BREAKING CHANGE, followed by a colon, space, and description, e.g., _BREAKING CHANGE: environment variables now take precedence over config files_.
13. If included in the type/scope prefix, breaking changes MUST be indicated by a \`'!'\` immediately before the \`:\`. If \`'!'\` is used, \`BREAKING CHANGE:\` MAY be omitted from the footer section, and the commit description SHALL be used to describe the breaking change.
14. Types other than \`feat\` and \`fix\` MAY be used in your commit messages, e.g., _docs: update ref docs._
15. The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of BREAKING CHANGE which MUST be uppercase.
16. BREAKING-CHANGE MUST be synonymous with BREAKING CHANGE, when used as a token in a footer.

## Why Use Conventional Commits

- Automatically generating CHANGELOGs.
- Automatically determining a semantic version bump (based on the types of commits landed).
- Communicating the nature of changes to teammates, the public, and other stakeholders.
- Triggering build and publish processes.
- Making it easier for people to contribute to your projects, by allowing them to explore a more structured commit history.

## Important Notes

- By default, pre-commit checks (defined in \`.pre-commit-config.yaml\`) will run to ensure code quality
  - IMPORTANT: DO NOT SKIP pre-commit checks
- ALWAYS attribute AI-Assisted Code Authorship using trailers (e.g., \`Assistant-model: Claude Code\`)
- If specific files are already staged, the command will only commit those files
- If no files are staged, it will automatically stage all modified and new files
- The commit message will be constructed based on the changes detected
- Before committing, the command will review the diff to identify if multiple commits would be more appropriate
- If suggesting multiple commits, it will help you stage and commit the changes separately
- Always reviews the commit diff to ensure the message matches the changes`,
  },
  {
    name: "research-codebase",
    description: "Document codebase as-is with research directory for historical context",
    aliases: ["research"],
    prompt: `# Research Codebase

Document the codebase structure and patterns: $ARGUMENTS

## Purpose

This skill analyzes and documents an existing codebase to create a comprehensive research directory that serves as historical context for future development. The research artifacts help new contributors understand the codebase quickly and provide a foundation for planning changes.

## Output Structure

Create a \`research/\` directory with the following artifacts:

### 1. research/architecture.md
Document the high-level architecture:
- System overview and purpose
- Key architectural patterns used (MVC, microservices, etc.)
- Component boundaries and responsibilities
- Data flow between components
- External dependencies and integrations

### 2. research/directory-structure.md
Map the directory structure with explanations:
- Root-level directories and their purposes
- Key subdirectories and their contents
- Configuration file locations
- Test directory organization
- Build/output directories

### 3. research/tech-stack.md
Catalog the technology stack:
- Programming languages and versions
- Frameworks and libraries with versions
- Build tools and task runners
- Testing frameworks
- Development dependencies vs production dependencies

### 4. research/entry-points.md
Identify entry points and execution flows:
- Application entry points (main files)
- CLI entry points (if applicable)
- API entry points and routes
- Event handlers and listeners
- Startup and initialization sequences

### 5. research/patterns.md
Document coding patterns and conventions:
- File naming conventions
- Code organization patterns
- Error handling patterns
- Logging conventions
- API design patterns

### 6. research/data-models.md
Document data structures and schemas:
- Database schemas (if applicable)
- TypeScript/JavaScript interfaces and types
- Configuration schemas
- API request/response schemas

### 7. research/dependencies.md
Analyze external dependencies:
- Critical dependencies and their purposes
- Dependency relationships
- Potential upgrade considerations
- Security considerations

## Process

1. **Explore**: Use Glob and Grep to scan the codebase structure
2. **Analyze**: Read key files to understand patterns and architecture
3. **Document**: Create clear, concise documentation in the research directory
4. **Verify**: Ensure all artifacts are accurate and complete

## Guidelines

- Document what EXISTS, not what should exist
- Be objective and factual
- Note any technical debt or inconsistencies observed
- Include file references (e.g., \`src/index.ts:42\`) where relevant
- Keep each document focused and scannable
- Use markdown formatting for readability

## Example Usage

\`\`\`
/research-codebase                     # Full codebase analysis
/research-codebase authentication      # Focus on auth-related code
/research-codebase src/api             # Focus on specific directory
\`\`\``,
  },
  {
    name: "create-spec",
    description: "Generate technical specification from research",
    aliases: ["spec"],
    prompt: `# Create Technical Specification

Generate a technical specification for: $ARGUMENTS

## Purpose

This skill creates a detailed technical specification document based on the research directory artifacts. The spec serves as a blueprint for implementation, translating high-level requirements into actionable technical decisions.

## Prerequisites

Before running this skill, ensure:
1. The \`research/\` directory exists with documentation from \`/research-codebase\`
2. You have clear requirements or goals for the feature/refactor

## Input Sources

Read and synthesize information from:
- \`research/architecture.md\` - Understand existing system design
- \`research/patterns.md\` - Follow established conventions
- \`research/tech-stack.md\` - Use existing technologies
- \`research/data-models.md\` - Understand data structures
- \`research/entry-points.md\` - Identify integration points

## Output Structure

Create \`research/spec.md\` with the following sections:

### 1. Overview
- Feature/refactor summary (1-2 paragraphs)
- Goals and success criteria
- Out of scope items

### 2. Technical Approach
- High-level architecture changes
- Key design decisions with rationale
- Alternative approaches considered and why rejected

### 3. Component Design
For each component/module affected:
- Purpose and responsibility
- Public interface (functions, methods, types)
- Internal implementation notes
- Dependencies (what it needs)
- Dependents (what uses it)

### 4. Data Model Changes
- New types/interfaces
- Schema changes (if applicable)
- Migration strategy (if applicable)

### 5. API Changes
- New endpoints or methods
- Request/response formats
- Breaking changes (if any)

### 6. Integration Points
- How new code integrates with existing system
- Event flows and data flows
- External service interactions

### 7. Error Handling
- Expected error scenarios
- Error recovery strategies
- User-facing error messages

### 8. Testing Strategy
- Unit test requirements
- Integration test requirements
- Edge cases to cover

### 9. Implementation Order
Suggested sequence for implementation:
1. Foundation (types, interfaces)
2. Core logic
3. Integration
4. Tests
5. Documentation

### 10. Open Questions
- Unresolved technical decisions
- Items needing stakeholder input
- Risks and mitigations

## Guidelines

- Be specific and actionable
- Include code snippets for complex interfaces
- Reference existing code patterns when applicable
- Keep the spec focused on HOW, not just WHAT
- Flag any assumptions being made
- Estimate relative complexity (simple/medium/complex) for each component

## Example Usage

\`\`\`
/create-spec add user authentication
/create-spec refactor database layer to use repository pattern
/create-spec implement caching for API responses
\`\`\``,
  },
  {
    name: "create-feature-list",
    description: "Break spec into implementable tasks",
    aliases: ["features"],
    prompt: `# Create Feature List

Break down the specification into implementable tasks: $ARGUMENTS

## Purpose

This skill transforms a technical specification into a structured list of implementable features. Each feature is atomic, testable, and ordered by dependency and priority.

## Prerequisites

Before running this skill, ensure:
1. The \`research/spec.md\` exists with a technical specification from \`/create-spec\`
2. You understand the overall architecture and approach

## Input Sources

Read and analyze:
- \`research/spec.md\` - The technical specification to break down
- \`research/architecture.md\` - Understand component boundaries
- \`research/patterns.md\` - Follow established conventions

## Output Structure

Create two files:

### 1. research/feature-list.json

A JSON file with the following schema:

\`\`\`json
{
  "features": [
    {
      "category": "functional" | "refactor" | "test" | "documentation" | "ui" | "e2e",
      "description": "Brief description of the feature",
      "steps": [
        "Step 1: Specific action",
        "Step 2: Another action",
        "..."
      ],
      "passes": false
    }
  ]
}
\`\`\`

### 2. research/progress.txt

Initialize or update the progress file:

\`\`\`
# Progress Log

## [Date] - Project: [Name]

### Overview
- Total features: N
- Completed: 0
- Remaining: N

### Next Up
- Feature 1 description
\`\`\`

## Feature Breakdown Guidelines

### Ordering Rules
1. **Foundation first**: Types, interfaces, schemas
2. **Dependencies**: Features that others depend on come first
3. **Core logic**: Business logic before integration
4. **Integration**: Connect components together
5. **Tests**: Unit tests, then integration tests
6. **Documentation**: After implementation is stable

### Feature Sizing
- Each feature should be completable in a single focused session
- If a feature has more than 5-7 steps, consider splitting it
- Each feature should be independently testable

### Categories Explained
- **functional**: New functionality or behavior
- **refactor**: Code restructuring without behavior change
- **test**: Test suite additions
- **documentation**: README, inline docs, API docs
- **ui**: User interface components
- **e2e**: End-to-end integration features

### Step Writing
Each step should be:
- **Specific**: "Add UserService class to src/services/" not "Create service"
- **Verifiable**: Can be checked for completion
- **Atomic**: One clear action per step

## JSON Schema

\`\`\`typescript
interface FeatureList {
  features: Feature[];
}

interface Feature {
  /** Category of the feature */
  category: "functional" | "refactor" | "test" | "documentation" | "ui" | "e2e";
  /** Brief description of what this feature accomplishes */
  description: string;
  /** Ordered list of implementation steps */
  steps: string[];
  /** Whether all tests for this feature pass (initially false) */
  passes: boolean;
}
\`\`\`

## Example Output

\`\`\`json
{
  "features": [
    {
      "category": "functional",
      "description": "Create UserRepository interface for data access abstraction",
      "steps": [
        "Define UserRepository interface in src/repositories/types.ts",
        "Add CRUD method signatures: create, findById, findByEmail, update, delete",
        "Export interface from repositories index"
      ],
      "passes": false
    },
    {
      "category": "functional",
      "description": "Implement InMemoryUserRepository for testing",
      "steps": [
        "Create InMemoryUserRepository class implementing UserRepository",
        "Implement all CRUD methods using Map storage",
        "Add to dependency injection container"
      ],
      "passes": false
    },
    {
      "category": "test",
      "description": "Add unit tests for UserRepository implementations",
      "steps": [
        "Create tests/repositories/user-repository.test.ts",
        "Test all CRUD operations",
        "Test edge cases: not found, duplicate email"
      ],
      "passes": false
    }
  ]
}
\`\`\`

## Guidelines

- Start simple - foundation features first
- Each feature should have clear acceptance criteria via its steps
- Don't skip tests - include them as separate features
- Group related features but keep them atomic
- The \`passes\` field starts as \`false\` and is set to \`true\` after tests pass

## Example Usage

\`\`\`
/create-feature-list                    # Break down research/spec.md
/create-feature-list auth-module        # Focus on auth portion of spec
\`\`\``,
  },
  {
    name: "implement-feature",
    description: "Implement next feature from list",
    aliases: ["impl"],
    prompt: `# Implement Feature

Implement the next feature from the feature list: $ARGUMENTS

## Purpose

This skill implements a single feature from \`research/feature-list.json\`, following the defined steps and updating the feature status upon completion.

## Prerequisites

Before running this skill, ensure:
1. \`research/feature-list.json\` exists with features to implement
2. You understand the codebase architecture from \`research/\` artifacts
3. The development environment is ready

## Process

### 1. Load Feature List
Read \`research/feature-list.json\` and identify the next feature to implement:
- If \`$ARGUMENTS\` specifies a feature description or index, use that
- Otherwise, find the first feature where \`passes: false\`

### 2. Review Feature Context
For the selected feature:
- Read its \`description\` to understand the goal
- Review its \`steps\` array for implementation guidance
- Check \`category\` to understand the type of work

### 3. Implement Each Step
For each step in the feature:
1. Understand what needs to be done
2. Find relevant existing code patterns
3. Implement the change
4. Verify it works (quick test or visual check)

### 4. Write Tests
After implementation:
- Create unit tests for new functions/classes
- Add integration tests if the feature connects components
- Run existing tests to ensure no regressions

### 5. Update Feature Status
After all tests pass:
1. Update the feature's \`passes\` field to \`true\` in \`research/feature-list.json\`
2. Append progress to \`research/progress.txt\`

## Implementation Guidelines

### Code Quality
- Follow existing code patterns and conventions
- Keep functions small and focused (single responsibility)
- Add appropriate error handling
- Include TypeScript types for all new code

### Testing Requirements
- Each new function should have at least one test
- Test both success and error cases
- Use descriptive test names that explain what is being tested

### Documentation
- Add JSDoc comments for public functions
- Update relevant documentation if behavior changes
- Include inline comments for complex logic only

## Feature Categories

### functional
New features or behavior:
- Implement new APIs, components, or utilities
- Add new user-facing functionality

### refactor
Code restructuring:
- Improve code organization without changing behavior
- Extract common patterns into utilities
- Rename for clarity

### test
Test additions:
- Unit tests for existing code
- Integration tests
- End-to-end tests

### documentation
Documentation updates:
- README updates
- API documentation
- Code comments

### ui
User interface work:
- Component creation
- Styling changes
- User interaction improvements

### e2e
End-to-end features:
- Full workflow implementation
- Cross-component integration

## Progress Tracking

Update \`research/progress.txt\` with:

\`\`\`
## [Date] - Feature: [Description]

### Implemented
- Step 1 completed
- Step 2 completed
- ...

### Tests Added
- test_name: description

### Files Modified
- path/to/file.ts - what changed
\`\`\`

## Error Handling

If you encounter issues:
1. Don't modify the feature's \`passes\` status
2. Document the issue in \`research/progress.txt\`
3. Add any discovered bugs as new features with high priority

## Example Usage

\`\`\`
/implement-feature                      # Implement next pending feature
/implement-feature UserRepository       # Implement specific feature by name
/implement-feature 3                    # Implement feature at index 3
\`\`\``,
  },
  {
    name: "create-gh-pr",
    description: "Push and create pull request",
    aliases: ["pr"],
    prompt: `# Create GitHub Pull Request

Push changes and create a pull request: $ARGUMENTS

## Purpose

This skill commits any unstaged changes, pushes to the remote repository, and creates a GitHub pull request with a well-formatted description.

## Prerequisites

- Git repository with a remote configured
- GitHub CLI (\`gh\`) installed and authenticated
- Changes ready to commit (staged or unstaged)

## Process

### 1. Check Repository State

\`\`\`bash
# Check current branch
git branch --show-current

# Check remote tracking
git remote -v

# Check for uncommitted changes
git status --porcelain
\`\`\`

### 2. Commit Changes (if any)

If there are uncommitted changes:
\`\`\`bash
# Stage all changes
git add -A

# Create commit with conventional format
git commit -m "feat: description of changes"
\`\`\`

### 3. Push to Remote

\`\`\`bash
# Push current branch (create upstream if needed)
git push -u origin HEAD
\`\`\`

### 4. Create Pull Request

\`\`\`bash
# Create PR with gh CLI
gh pr create --title "PR Title" --body "PR Description"
\`\`\`

## PR Template

Use this format for the PR body:

\`\`\`markdown
## Summary

Brief description of what this PR accomplishes.

## Changes

- Change 1
- Change 2
- Change 3

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Related Issues

Closes #issue_number (if applicable)
\`\`\`

## gh CLI Commands Reference

### Create PR
\`\`\`bash
# Basic PR creation
gh pr create --title "Title" --body "Body"

# Create draft PR
gh pr create --draft --title "Title" --body "Body"

# Create PR with specific base branch
gh pr create --base main --title "Title" --body "Body"

# Create PR and open in browser
gh pr create --web
\`\`\`

### View PR
\`\`\`bash
# View current branch's PR
gh pr view

# View specific PR
gh pr view 123

# View PR in browser
gh pr view --web
\`\`\`

### List PRs
\`\`\`bash
# List open PRs
gh pr list

# List your PRs
gh pr list --author @me
\`\`\`

## Guidelines

### PR Title
- Use conventional commit format: \`type(scope): description\`
- Keep under 72 characters
- Be specific about what changed

### PR Description
- Summarize the purpose of the changes
- List key modifications
- Include testing information
- Reference related issues

### Branch Naming
- Use descriptive branch names
- Format: \`type/description\` (e.g., \`feat/user-auth\`, \`fix/login-bug\`)

## Error Handling

### No Remote Configured
\`\`\`bash
git remote add origin https://github.com/user/repo.git
\`\`\`

### Authentication Issues
\`\`\`bash
gh auth login
\`\`\`

### PR Already Exists
\`\`\`bash
# View existing PR
gh pr view

# Update existing PR
gh pr edit --title "New Title" --body "New Body"
\`\`\`

## Example Usage

\`\`\`
/create-gh-pr                           # Create PR with auto-generated description
/create-gh-pr "Add user authentication" # Create PR with specific title
/create-gh-pr --draft                   # Create draft PR
\`\`\``,
  },
];

// ============================================================================
// SKILL DEFINITIONS (legacy disk-based)
// ============================================================================

/**
 * Available skill definitions from the system-reminder skill list.
 *
 * Each entry defines a skill command that invokes a specific skill via session.
 * These are loaded from disk and are used as fallback when no built-in skill exists.
 */
export const SKILL_DEFINITIONS: SkillMetadata[] = [
  // Core skills
  {
    name: "commit",
    description: "Create well-formatted commits with conventional commit format",
    aliases: ["ci"],
  },
  {
    name: "research-codebase",
    description: "Document codebase as-is with research directory for historical context",
    aliases: ["research"],
  },
  {
    name: "create-spec",
    description: "Create a detailed execution plan for implementing features or refactors",
    aliases: ["spec"],
  },
  {
    name: "create-feature-list",
    description: "Create a detailed feature-list.json and progress.txt for implementation",
    aliases: ["features"],
  },
  {
    name: "implement-feature",
    description: "Implement a SINGLE feature from feature-list.json based on execution plan",
    aliases: ["impl"],
  },
  {
    name: "create-gh-pr",
    description: "Commit unstaged changes, push changes, submit a pull request",
    aliases: ["pr"],
  },
  {
    name: "explain-code",
    description: "Explain code functionality in detail",
    aliases: ["explain"],
  },

  // Ralph skills
  {
    name: "ralph:ralph-loop",
    description: "Start Ralph Loop in current session",
    aliases: ["ralph-loop"], // Note: "loop" alias reserved for atomic workflow
  },
  {
    name: "ralph:cancel-ralph",
    description: "Cancel active Ralph Loop",
    aliases: ["cancel-ralph", "stop-ralph"],
  },
  {
    name: "ralph:ralph-help",
    description: "Explain Ralph Loop plugin and available commands",
    aliases: ["ralph-help"],
  },

  // Additional skills from system-reminder
  {
    name: "prompt-engineer",
    description: "Create, improve, or optimize prompts for Claude using best practices",
    aliases: ["prompt"],
  },
  {
    name: "testing-anti-patterns",
    description: "Identify and prevent testing anti-patterns when writing tests",
    aliases: ["test-patterns"],
    hidden: true, // Helper skill, not typically invoked directly
  },
];

// ============================================================================
// SKILL PROMPT LOADING
// ============================================================================

/**
 * Paths to search for skill/command definitions.
 * Order matters - first found wins.
 */
const SKILL_SEARCH_PATHS = [
  // Claude Code commands
  ".claude/commands",
  // OpenCode commands
  ".opencode/command",
  // GitHub Copilot commands (if they exist)
  ".github/commands",
];

/**
 * Load a skill prompt from disk by searching common paths.
 * Returns the skill content with frontmatter stripped.
 *
 * @param skillName - The skill name (e.g., "research-codebase")
 * @returns The skill prompt content, or null if not found
 */
function loadSkillPrompt(skillName: string): string | null {
  // Handle namespaced skills (e.g., "ralph:ralph-loop" -> "ralph-loop")
  const baseName = skillName.includes(":") ? skillName.split(":").pop()! : skillName;

  for (const searchPath of SKILL_SEARCH_PATHS) {
    const fullPath = join(process.cwd(), searchPath, `${baseName}.md`);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        // Strip YAML frontmatter if present
        return stripFrontmatter(content);
      } catch {
        // Continue to next path
      }
    }
  }

  return null;
}

/**
 * Strip YAML frontmatter from markdown content.
 * Frontmatter is enclosed by "---" delimiters at the start of the file.
 */
function stripFrontmatter(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return content;
  }

  // Find the closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return content;
  }

  // Return content after frontmatter
  return lines.slice(endIndex + 1).join("\n").trim();
}

/**
 * Expand $ARGUMENTS placeholder in skill prompt with user arguments.
 */
function expandArguments(prompt: string, args: string): string {
  return prompt.replace(/\$ARGUMENTS/g, args || "[no arguments provided]");
}

/**
 * Get a builtin skill by name.
 *
 * @param name - Skill name (or alias)
 * @returns BuiltinSkill if found, undefined otherwise
 */
export function getBuiltinSkill(name: string): BuiltinSkill | undefined {
  const lowerName = name.toLowerCase();
  return BUILTIN_SKILLS.find(
    (s) =>
      s.name.toLowerCase() === lowerName ||
      s.aliases?.some((a) => a.toLowerCase() === lowerName)
  );
}

// ============================================================================
// COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a skill.
 *
 * @param metadata - Skill metadata
 * @returns Command definition for the skill
 */
function createSkillCommand(metadata: SkillMetadata): CommandDefinition {
  return {
    name: metadata.name,
    description: metadata.description,
    category: "skill",
    aliases: metadata.aliases,
    hidden: metadata.hidden,
    execute: (args: string, context: CommandContext): CommandResult => {
      const skillArgs = args.trim();

      // Priority 1: Check for builtin skill with embedded prompt
      const builtinSkill = getBuiltinSkill(metadata.name);
      if (builtinSkill) {
        // Use the embedded prompt directly
        const expandedPrompt = expandArguments(builtinSkill.prompt, skillArgs);
        context.sendMessage(expandedPrompt);
        return {
          success: true,
        };
      }

      // Priority 2: Load the skill prompt from disk
      // This ensures the TUI can stream the agent's response since we send
      // the expanded prompt as a regular message rather than a slash command.
      const skillPrompt = loadSkillPrompt(metadata.name);

      if (skillPrompt) {
        // Expand $ARGUMENTS placeholder with user arguments
        const expandedPrompt = expandArguments(skillPrompt, skillArgs);
        context.sendMessage(expandedPrompt);
      } else {
        // Fallback: send slash command to agent's native skill system
        // This handles skills that aren't defined in local .claude/commands/ etc.
        // The agent SDK may process it internally without streaming output.
        const invocationMessage = skillArgs
          ? `/${metadata.name} ${skillArgs}`
          : `/${metadata.name}`;
        context.sendMessage(invocationMessage);
      }

      return {
        success: true,
        // No message displayed - the agent will handle displaying the skill output
      };
    },
  };
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Skill commands created from definitions.
 */
export const skillCommands: CommandDefinition[] = SKILL_DEFINITIONS.map(
  createSkillCommand
);

/**
 * Register all skill commands with the global registry.
 *
 * Call this function during application initialization.
 *
 * @example
 * ```typescript
 * import { registerSkillCommands } from "./skill-commands";
 *
 * // In app initialization
 * registerSkillCommands();
 * ```
 */
export function registerSkillCommands(): void {
  for (const command of skillCommands) {
    // Skip if already registered (idempotent)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}

/**
 * Get a skill by name.
 *
 * @param name - Skill name (or alias)
 * @returns SkillMetadata if found, undefined otherwise
 */
export function getSkillMetadata(name: string): SkillMetadata | undefined {
  const lowerName = name.toLowerCase();
  return SKILL_DEFINITIONS.find(
    (s) =>
      s.name.toLowerCase() === lowerName ||
      s.aliases?.some((a) => a.toLowerCase() === lowerName)
  );
}

/**
 * Check if a skill name is a Ralph skill.
 *
 * @param name - Skill name to check
 * @returns True if this is a Ralph skill
 */
export function isRalphSkill(name: string): boolean {
  return name.toLowerCase().startsWith("ralph:");
}

/**
 * Get all Ralph skills.
 *
 * @returns Array of Ralph skill metadata
 */
export function getRalphSkills(): SkillMetadata[] {
  return SKILL_DEFINITIONS.filter((s) => isRalphSkill(s.name));
}

/**
 * Get all non-Ralph skills.
 *
 * @returns Array of core skill metadata
 */
export function getCoreSkills(): SkillMetadata[] {
  return SKILL_DEFINITIONS.filter((s) => !isRalphSkill(s.name));
}

// Export helper functions for testing and external use
export { loadSkillPrompt, stripFrontmatter, expandArguments };
