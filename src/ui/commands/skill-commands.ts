/**
 * Skill Commands for Chat UI
 *
 * Registers skill commands that invoke predefined skills via session.
 * Skills are specialized prompts/workflows that can be triggered via slash commands.
 *
 * Skills are now defined as builtins with embedded prompts in BUILTIN_SKILLS array.
 * The $ARGUMENTS placeholder is expanded with user arguments before sending to the agent.
 *
 * Reference: Feature 4 - Implement skill command registration
 */

import type {
  CommandDefinition,
  CommandContext,
  CommandResult,
} from "./registry.ts";
import { globalRegistry } from "./registry.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseMarkdownFrontmatter } from "../../utils/markdown.ts";

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
  /** Hint text showing expected arguments (e.g., "[message] [--amend]") */
  argumentHint?: string;
  /** List of required argument names. Command returns an error when any are missing. */
  requiredArguments?: string[];
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
    description: "Create well-formatted commits with conventional commit format.",
    aliases: ["ci"],
    argumentHint: "[message] | --amend",
    prompt: `# Smart Git Commit

Create well-formatted commit: $ARGUMENTS

## Current Repository State

- Git status: !\`git status --porcelain\`
- Current branch: !\`git branch --show-current\`
- Staged changes: !\`git diff --cached --stat\`
- Unstaged changes: !\`git diff --stat\`
- Recent commits: !\`git log --oneline -5\`

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
feat'!': send an email to the customer when a product is shipped
\`\`\`

### Commit message with scope and \`'!'\` to draw attention to breaking change

\`\`\`
feat(api)'!': send an email to the customer when a product is shipped
\`\`\`

### Commit message with both \`'!'\` and BREAKING CHANGE footer

\`\`\`
chore'!': drop support for Node 6

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

## FAQ

### How should I deal with commit messages in the initial development phase?

We recommend that you proceed as if you've already released the product. Typically _somebody_, even if it's your fellow software developers, is using your software. They'll want to know what's fixed, what breaks etc.

### Are the types in the commit title uppercase or lowercase?

Any casing may be used, but it's best to be consistent.

### What do I do if the commit conforms to more than one of the commit types?

Go back and make multiple commits whenever possible. Part of the benefit of Conventional Commits is its ability to drive us to make more organized commits and PRs.

### Doesn't this discourage rapid development and fast iteration?

It discourages moving fast in a disorganized way. It helps you be able to move fast long term across multiple projects with varied contributors.

### Might Conventional Commits lead developers to limit the type of commits they make because they'll be thinking in the types provided?

Conventional Commits encourages us to make more of certain types of commits such as fixes. Other than that, the flexibility of Conventional Commits allows your team to come up with their own types and change those types over time.

### How does this relate to SemVer?

\`fix\` type commits should be translated to \`PATCH\` releases. \`feat\` type commits should be translated to \`MINOR\` releases. Commits with \`BREAKING CHANGE\` in the commits, regardless of type, should be translated to \`MAJOR\` releases.

### How should I version my extensions to the Conventional Commits Specification, e.g. \`@jameswomack/conventional-commit-spec\`?

We recommend using SemVer to release your own extensions to this specification (and encourage you to make these extensions'!')

### What do I do if I accidentally use the wrong commit type?

#### When you used a type that's of the spec but not the correct type, e.g. \`fix\` instead of \`feat\`

Prior to merging or releasing the mistake, we recommend using \`git rebase -i\` to edit the commit history. After release, the cleanup will be different according to what tools and processes you use.

#### When you used a type _not_ of the spec, e.g. \`feet\` instead of \`feat\`

In a worst case scenario, it's not the end of the world if a commit lands that does not meet the Conventional Commits specification. It simply means that commit will be missed by tools that are based on the spec.

### Do all my contributors need to use the Conventional Commits specification?

No'!' If you use a squash based workflow on Git lead maintainers can clean up the commit messages as they're merged—adding no workload to casual committers. A common workflow for this is to have your git system automatically squash commits from a pull request and present a form for the lead maintainer to enter the proper git commit message for the merge.

### How does Conventional Commits handle revert commits?

Reverting code can be complicated: are you reverting multiple commits? if you revert a feature, should the next release instead be a patch?

Conventional Commits does not make an explicit effort to define revert behavior. Instead we leave it to tooling authors to use the flexibility of _types_ and _footers_ to develop their logic for handling reverts.

One recommendation is to use the \`revert\` type, and a footer that references the commit SHAs that are being reverted:

\`\`\`
revert: let us never again speak of the noodle incident

Refs: 676104e, a215868
\`\`\`

### Attributing AI-Assisted Code Authorship

When using AI tools to generate code, it can be beneficial to maintain transparency about authorship for accountability, code review, and auditing purposes. This can be done easily by using Git trailers that append structured metadata to the end of commit messages.

This can be done by appending one or more custom trailers in the commit message, such as:

\`\`\`
Assistant-model: Claude Code
\`\`\`

Because most Git tooling expects \`Co-authored-by\` trailers to be formatted as email addresses, you should use a different trailer key to avoid confusion and to distinguish authorship from assistance.

Trailers can be added manually at the end of a commit message, or by using the \`git commit\` command with the \`--trailer\` option:

\`\`\`
git commit --message "Implement feature" --trailer "Assistant-model: Claude Code"
\`\`\`

Trailers can be displayed using the [pretty formats](https://git-scm.com/docs/pretty-formats#Documentation/pretty-formats.txt-trailersoptions) option to \`git log\` command. For example, for a formatted history showing the hash, author name, and assistant models used for each commit:

\`\`\`
git log --color --pretty=format:"%C(yellow)%h%C(reset) %C(blue)%an%C(reset) [%C(magenta)%(trailers:key=Assistant-model,valueonly=true,separator=%x2C)%C(reset)] %s%C(bold cyan)%d%C(reset)"
\`\`\`

\`\`\`
2100e6c Author [Claude Code] Test commit 4 (HEAD -> work-item-8)
7120221 Author [Claude Code] Test commit 3
ea03d91 Author [] Test commit 2
f93fd8e Author [Claude Code] Test commit 1
dde0159 Claude Code [] Test work item (#7) (origin/main, origin/HEAD)
\`\`\`

## Important Notes

- By default, pre-commit checks (defined in \`.pre-commit-config.yaml\`) will run to ensure code quality
  - IMPORTANT: DO NOT SKIP pre-commit checks
- ALWAYS attribute AI-Assisted Code Authorship
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
    argumentHint: "<research-question>",
    requiredArguments: ["research-question"],
    prompt: `# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions by spawning parallel sub-agents and synthesizing their findings.

The user's research question/request is: **$ARGUMENTS**

## Steps to follow after receiving the research query:

IMPORTANT: OPTIMIZE the user's research question request using your prompt-engineer skill and confirm that the your refined question captures the user's intent BEFORE proceeding using the \`AskUserQuestion\` tool.

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (tickets, docs, or other notes), read them FULLY first
   - **IMPORTANT**: Use the \`readFile\` tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks
   - This ensures you have full context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Take time to ultrathink about the underlying patterns, connections, and architectural implications the user might be seeking
   - Identify specific components, patterns, or concepts to investigate
   - Create a research plan using TodoWrite to track all subtasks
   - Consider which directories, files, or architectural patterns are relevant

3. **Spawn parallel sub-agent tasks for comprehensive research:**
   - Create multiple Task agents to research different aspects concurrently
   - We now have specialized agents that know how to do specific research tasks:

   **For codebase research:**
   - Use the **codebase-locator** agent to find WHERE files and components live
   - Use the **codebase-analyzer** agent to understand HOW specific code works (without critiquing it)
   - Use the **codebase-pattern-finder** agent to find examples of existing patterns (without evaluating them)
   - Output directory: \`research/docs/\`
   - Examples:
     - The database logic is found and can be documented in \`research/docs/2024-01-10-database-implementation.md\`
     - The authentication flow is found and can be documented in \`research/docs/2024-01-11-authentication-flow.md\`

   **IMPORTANT**: All agents are documentarians, not critics. They will describe what exists without suggesting improvements or identifying issues.

   **For research directory:**
   - Use the **codebase-research-locator** agent to discover what documents exist about the topic
   - Use the **codebase-research-analyzer** agent to extract key insights from specific documents (only the most relevant ones)

   **For online search:**
   - VERY IMPORTANT: In case you discover external libraries as dependencies, use the **codebase-online-researcher** agent for external documentation and resources
     - If you use DeepWiki tools, instruct the agent to return references to code snippets or documentation, PLEASE INCLUDE those references (e.g. source file names, line numbers, etc.)
     - If you perform a web search using the WebFetch/WebSearch tools, instruct the agent to return LINKS with their findings, and please INCLUDE those links in the research document
     - Output directory: \`research/docs/\`
     - Examples:
       - If researching \`Redis\` locks usage, the agent might find relevant usage and create a document \`research/docs/2024-01-15-redis-locks-usage.md\` with internal links to Redis docs and code references
       - If researching \`OAuth\` flows, the agent might find relevant external articles and create a document \`research/docs/2024-01-16-oauth-flows.md\` with links to those articles

   The key is to use these agents intelligently:
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings to document how they work
   - Run multiple agents in parallel when they're searching for different things
   - Each agent knows its job - just tell it what you're looking for
   - Don't write detailed prompts about HOW to search - the agents already know
   - Remind agents they are documenting, not evaluating or improving

4. **Wait for all sub-agents to complete and synthesize findings:**
   - IMPORTANT: Wait for ALL sub-agent tasks to complete before proceeding
   - Compile all sub-agent results (both codebase and research findings)
   - Prioritize live codebase findings as primary source of truth
   - Use research findings as supplementary historical context
   - Connect findings across different components
   - Include specific file paths and line numbers for reference
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence

5. **Generate research document:**

   - Follow the directory structure for research documents:
\`\`\`
research/
├── tickets/
│   ├── YYYY-MM-DD-XXXX-description.md
├── docs/
│   ├── YYYY-MM-DD-topic.md
├── notes/
│   ├── YYYY-MM-DD-meeting.md
├── ...
└──
\`\`\`
   - Naming conventions:
      - YYYY-MM-DD is today's date
      - topic is a brief kebab-case description of the research topic
      - meeting is a brief kebab-case description of the meeting topic
      - XXXX is the ticket number (omit if no ticket)
      - description is a brief kebab-case description of the research topic
      - Examples:
        - With ticket: \`2025-01-08-1478-parent-child-tracking.md\`
        - Without ticket: \`2025-01-08-authentication-flow.md\`
   - Structure the document with YAML frontmatter followed by content:
     \`\`\`markdown
     ---
     date: !\`date '+%Y-%m-%d %H:%M:%S %Z'\`
     researcher: [Researcher name from thoughts status]
     git_commit: !\`git rev-parse --verify HEAD 2>/dev/null || echo "no-commits"\`
     branch: !\`git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unborn"\`
     repository: !\`basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown-repo"\`
     topic: "[User's Question/Topic]"
     tags: [research, codebase, relevant-component-names]
     status: complete
     last_updated: !\`date '+%Y-%m-%d'\`
     last_updated_by: [Researcher name]
     ---

     # Research

     ## Research Question
     [Original user query]

     ## Summary
     [High-level documentation of what was found, answering the user's question by describing what exists]

     ## Detailed Findings

     ### [Component/Area 1]
     - Description of what exists ([file.ext:line](link))
     - How it connects to other components
     - Current implementation details (without evaluation)

     ### [Component/Area 2]
     ...

     ## Code References
     - \`path/to/file.py:123\` - Description of what's there
     - \`another/file.ts:45-67\` - Description of the code block

     ## Architecture Documentation
     [Current patterns, conventions, and design implementations found in the codebase]

     ## Historical Context (from research/)
     [Relevant insights from research/ directory with references]
     - \`research/docs/YYYY-MM-DD-topic.md\` - Information about module X
     - \`research/notes/YYYY-MM-DD-meeting.md\` - Past notes from internal engineering, customer, etc. discussions
     - ...

     ## Related Research
     [Links to other research documents in research/]

     ## Open Questions
     [Any areas that need further investigation]
     \`\`\`

1. **Add GitHub permalinks (if applicable):**
   - Check if on main branch or if commit is pushed: \`git branch --show-current\` and \`git status\`
   - If on main/master or pushed, generate GitHub permalinks:
     - Get repo info: \`gh repo view --json owner,name\`
     - Create permalinks: \`https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}\`
   - Replace local file references with permalinks in the document

2. **Present findings:**
   - Present a concise summary of findings to the user
   - Include key file references for easy navigation
   - Ask if they have follow-up questions or need clarification

3.  **Handle follow-up questions:**
   - If the user has follow-up questions, append to the same research document
   - Update the frontmatter fields \`last_updated\` and \`last_updated_by\` to reflect the update
   - Add \`last_updated_note: "Added follow-up research for [brief description]"\` to frontmatter
   - Add a new section: \`## Follow-up Research [timestamp]\`
   - Spawn new sub-agents as needed for additional investigation
   - Continue updating the document and syncing

## Important notes:
- Please DO NOT implement anything in this stage, just create the comprehensive research document
- Always use parallel Task agents to maximize efficiency and minimize context usage
- Always run fresh codebase research - never rely solely on existing research documents
- The \`research/\` directory provides historical context to supplement live findings
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Each sub-agent prompt should be specific and focused on read-only documentation operations
- Document cross-component connections and how systems interact
- Include temporal context (when the research was conducted)
- Link to GitHub when possible for permanent references
- Keep the main agent focused on synthesis, not deep file reading
- Have sub-agents document examples and usage patterns as they exist
- Explore all of research/ directory, not just research subdirectory
- **CRITICAL**: You and all sub-agents are documentarians, not evaluators
- **REMEMBER**: Document what IS, not what SHOULD BE
- **NO RECOMMENDATIONS**: Only describe the current state of the codebase
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values

- **Frontmatter consistency**:
  - Always include frontmatter at the beginning of research documents
  - Keep frontmatter fields consistent across all research documents
  - Update frontmatter when adding follow-up research
  - Use snake_case for multi-word field names (e.g., \`last_updated\`, \`git_commit\`)
  - Tags should be relevant to the research topic and components studied

## Final Output

- A collection of research files with comprehensive research findings, properly formatted and linked, ready for consumption to create detailed specifications or design documents.
- IMPORTANT: DO NOT generate any other artifacts or files OUTSIDE of the \`research/\` directory.`,
  },
  {
    name: "create-spec",
    description: "Create a detailed execution plan for implementing features or refactors in a codebase by leveraging existing research in the specified `research` directory.",
    aliases: ["spec"],
    argumentHint: "<research-path>",
    requiredArguments: ["research-path"],
    prompt: `You are tasked with creating a spec for implementing a new feature or system change in the codebase by leveraging existing research in the **$ARGUMENTS** path. If no research path is specified, use the entire \`research/\` directory. Follow the template below to produce a comprehensive specification in the \`specs\` folder using the findings from RELEVANT research documents. Tip: It's good practice to use the \`codebase-research-locator\` and \`codebase-research-analyzer\` agents to help you find and analyze the research documents. It is also HIGHLY recommended to cite relevant research throughout the spec for additional context.

<EXTREMELY_IMPORTANT>
Please DO NOT implement anything in this stage, just create the comprehensive spec as described below.
</EXTREMELY_IMPORTANT>

# [Project Name] Technical Design Document / RFC

| Document Metadata      | Details                                                                        |
| ---------------------- | ------------------------------------------------------------------------------ |
| Author(s)              | !\`git config user.name\`                                                        |
| Status                 | Draft (WIP) / In Review (RFC) / Approved / Implemented / Deprecated / Rejected |
| Team / Owner           |                                                                                |
| Created / Last Updated |                                                                                |

## 1. Executive Summary

*Instruction: A "TL;DR" of the document. Assume the reader is a VP or an engineer from another team who has 2 minutes. Summarize the Context (Problem), the Solution (Proposal), and the Impact (Value). Keep it under 200 words.*

> **Example:** This RFC proposes replacing our current nightly batch billing system with an event-driven architecture using Kafka and AWS Lambda. Currently, billing delays cause a 5% increase in customer support tickets. The proposed solution will enable real-time invoicing, reducing billing latency from 24 hours to <5 minutes.

## 2. Context and Motivation

*Instruction: Why are we doing this? Why now? Link to the Product Requirement Document (PRD).*

### 2.1 Current State

*Instruction: Describe the existing architecture. Use a "Context Diagram" if possible. Be honest about the flaws.*

- **Architecture:** Currently, Service A communicates with Service B via a shared SQL database.
- **Limitations:** This creates a tight coupling; when Service A locks the table, Service B times out.

### 2.2 The Problem

*Instruction: What is the specific pain point?*

- **User Impact:** Customers cannot download receipts during the nightly batch window.
- **Business Impact:** We are losing $X/month in churn due to billing errors.
- **Technical Debt:** The current codebase is untestable and has 0% unit test coverage.

## 3. Goals and Non-Goals

*Instruction: This is the contract Definition of Success. Be precise.*

### 3.1 Functional Goals

- [ ] Users must be able to export data in CSV format.
- [ ] System must support multi-tenant data isolation.

### 3.2 Non-Goals (Out of Scope)

*Instruction: Explicitly state what you are NOT doing. This prevents scope creep.*

- [ ] We will NOT support PDF export in this version (CSV only).
- [ ] We will NOT migrate data older than 3 years.
- [ ] We will NOT build a custom UI (API only).

## 4. Proposed Solution (High-Level Design)

*Instruction: The "Big Picture." Diagrams are mandatory here.*

### 4.1 System Architecture Diagram

*Instruction: Insert a C4 System Context or Container diagram. Show the "Black Boxes."*

- (Place Diagram Here - e.g., Mermaid diagram)

For example,

\`\`\`mermaid
%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#f8f9fa','primaryTextColor':'#2c3e50','primaryBorderColor':'#4a5568','lineColor':'#4a90e2','secondaryColor':'#ffffff','tertiaryColor':'#e9ecef','background':'#f5f7fa','mainBkg':'#f8f9fa','nodeBorder':'#4a5568','clusterBkg':'#ffffff','clusterBorder':'#cbd5e0','edgeLabelBackground':'#ffffff'}}}%%

flowchart TB
    %% ---------------------------------------------------------
    %% CLEAN ENTERPRISE DESIGN
    %% Professional • Trustworthy • Corporate Standards
    %% ---------------------------------------------------------

    %% STYLE DEFINITIONS
    classDef person fill:#5a67d8,stroke:#4c51bf,stroke-width:3px,color:#ffffff,font-weight:600,font-size:14px

    classDef systemCore fill:#4a90e2,stroke:#357abd,stroke-width:2.5px,color:#ffffff,font-weight:600,font-size:14px

    classDef systemSupport fill:#667eea,stroke:#5a67d8,stroke-width:2.5px,color:#ffffff,font-weight:600,font-size:13px

    classDef database fill:#48bb78,stroke:#38a169,stroke-width:2.5px,color:#ffffff,font-weight:600,font-size:13px

    classDef external fill:#718096,stroke:#4a5568,stroke-width:2.5px,color:#ffffff,font-weight:600,font-size:13px,stroke-dasharray:6 3

    %% NODES - CLEAN ENTERPRISE HIERARCHY

    User(("👤<br><b>User</b><br>")):::person

    subgraph SystemBoundary["◆ Primary System Boundary"]
        direction TB

        LoadBalancer{{"<b>Load Balancer</b><br>NGINX<br><i>Layer 7 Proxy</i>"}}:::systemCore

        API["<b>API Application</b><br>Go • Gin Framework<br><i>REST Endpoints</i>"]:::systemCore

        Worker(["<b>Background Worker</b><br>Go Runtime<br><i>Async Processing</i>"]):::systemSupport

        Cache[("💾<br><b>Cache Layer</b><br>Redis<br><i>In-Memory</i>")]:::database

        PrimaryDB[("🗄️<br><b>Primary Database</b><br>PostgreSQL<br><i>Persistent Storage</i>")]:::database
    end

    ExternalAPI{{"<b>External API</b><br>Third Party<br><i>HTTP/REST</i>"}}:::external

    %% RELATIONSHIPS - CLEAN FLOW

    User -->|"1. HTTPS Request<br>TLS 1.3"| LoadBalancer
    LoadBalancer -->|"2. Proxy Pass<br>Round Robin"| API

    API <-->|"3. Cache<br>Read/Write"| Cache
    API -->|"4. Persist Data<br>Transactional"| PrimaryDB
    API -.->|"5. Enqueue Event<br>Async"| Worker

    Worker -->|"6. Process Job<br>Execution"| PrimaryDB
    Worker -.->|"7. HTTP Call<br>Webhooks"| ExternalAPI

    %% STYLE BOUNDARY
    style SystemBoundary fill:#ffffff,stroke:#cbd5e0,stroke-width:2px,color:#2d3748,stroke-dasharray:8 4,font-weight:600,font-size:12px
\`\`\`

### 4.2 Architectural Pattern

*Instruction: Name the pattern (e.g., "Event Sourcing", "BFF - Backend for Frontend").*

- We are adopting a Publisher-Subscriber pattern where the Order Service publishes \`OrderCreated\` events, and the Billing Service consumes them asynchronously.

### 4.3 Key Components

| Component         | Responsibility              | Technology Stack  | Justification                                |
| ----------------- | --------------------------- | ----------------- | -------------------------------------------- |
| Ingestion Service | Validates incoming webhooks | Go, Gin Framework | High concurrency performance needed.         |
| Event Bus         | Decouples services          | Kafka             | Durable log, replay capability.              |
| Projections DB    | Read-optimized views        | MongoDB           | Flexible schema for diverse receipt formats. |

## 5. Detailed Design

*Instruction: The "Meat" of the document. Sufficient detail for an engineer to start coding.*

### 5.1 API Interfaces

*Instruction: Define the contract. Use OpenAPI/Swagger snippets or Protocol Buffer definitions.*

**Endpoint:** \`POST /api/v1/invoices\`

- **Auth:** Bearer Token (Scope: \`invoice:write\`)
- **Idempotency:** Required header \`X-Idempotency-Key\`
- **Request Body:**

\`\`\`json
{ "user_id": "uuid", "amount": 100.00, "currency": "USD" }
\`\`\`

### 5.2 Data Model / Schema

*Instruction: Provide ERDs (Entity Relationship Diagrams) or JSON schemas. Discuss normalization vs. denormalization.*

**Table:** \`invoices\` (PostgreSQL)

| Column    | Type | Constraints       | Description           |
| --------- | ---- | ----------------- | --------------------- |
| \`id\`      | UUID | PK                |                       |
| \`user_id\` | UUID | FK -> Users       | Partition Key         |
| \`status\`  | ENUM | 'PENDING', 'PAID' | Indexed for filtering |

### 5.3 Algorithms and State Management

*Instruction: Describe complex logic, state machines, or consistency models.*

- **State Machine:** An invoice moves from \`DRAFT\` -> \`LOCKED\` -> \`PROCESSING\` -> \`PAID\`.
- **Concurrency:** We use Optimistic Locking on the \`version\` column to prevent double-payments.

## 6. Alternatives Considered

*Instruction: Prove you thought about trade-offs. Why is your solution better than the others?*

| Option                           | Pros                               | Cons                                      | Reason for Rejection                                                          |
| -------------------------------- | ---------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- |
| Option A: Synchronous HTTP Calls | Simple to implement, Easy to debug | Tight coupling, cascading failures        | Latency requirements (200ms) make blocking calls risky.                       |
| Option B: RabbitMQ               | Lightweight, Built-in routing      | Less durable than Kafka, harder to replay | We need message replay for auditing (Compliance requirement).                 |
| Option C: Kafka (Selected)       | High throughput, Replayability     | Operational complexity                    | **Selected:** The need for auditability/replay outweighs the complexity cost. |

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

- **Authentication:** Services authenticate via mTLS.
- **Authorization:** Policy enforcement point at the API Gateway (OPA - Open Policy Agent).
- **Data Protection:** PII (Names, Emails) is encrypted at rest using AES-256.
- **Threat Model:** Primary threat is compromised API Key; remediation is rapid rotation and rate limiting.

### 7.2 Observability Strategy

- **Metrics:** We will track \`invoice_creation_latency\` (Histogram) and \`payment_failure_count\` (Counter).
- **Tracing:** All services propagate \`X-Trace-ID\` headers (OpenTelemetry).
- **Alerting:** PagerDuty triggers if \`5xx\` error rate > 1% for 5 minutes.

### 7.3 Scalability and Capacity Planning

- **Traffic Estimates:** 1M transactions/day = ~12 TPS avg / 100 TPS peak.
- **Storage Growth:** 1KB per record * 1M = 1GB/day.
- **Bottleneck:** The PostgreSQL Write node is the bottleneck. We will implement Read Replicas to offload traffic.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

- [ ] Phase 1: Deploy services in "Shadow Mode" (process traffic but do not email users).
- [ ] Phase 2: Enable Feature Flag \`new-billing-engine\` for 1% of internal users.
- [ ] Phase 3: Ramp to 100%.

### 8.2 Data Migration Plan

- **Backfill:** We will run a script to migrate the last 90 days of invoices from the legacy SQL server.
- **Verification:** A "Reconciliation Job" will run nightly to compare Legacy vs. New totals.

### 8.3 Test Plan

- **Unit Tests:** 
- **Integration Tests:**
- **End-to-End Tests:**

## 9. Open Questions / Unresolved Issues

*Instruction: List known unknowns. These must be resolved before the doc is marked "Approved".*

- [ ] Will the Legal team approve the 3rd party library for PDF generation?
- [ ] Does the current VPC peering allow connection to the legacy mainframe?`,
  },
  {
    name: "implement-feature",
    description: "Implement a SINGLE feature from `research/feature-list.json` based on the provided execution plan.",
    aliases: ["impl"],
    prompt: `You are tasked with implementing a SINGLE feature from the \`research/feature-list.json\` file.

# Getting up to speed
1. IMPORTANT: If you sense your context window is more than 60% full, run the \`/compact\` command with your \`SlashCommand\` tool.
2. Run \`pwd\` to see the directory you're working in. Only make edits within the current git repository.
3. Read the git logs and progress files (\`research/progress.txt\`) to get up to speed on what was recently worked on.
4. Read the \`research/feature-list.json\` file and choose the highest-priority features that's not yet done to work on.

# Typical Workflow

## Initialization

A typical workflow will start something like this:

\`\`\`
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
\`\`\`

## Sub-Agent Delegation

When implementing complex features or refactoring large codebases, consider delegating work to sub-agents. This helps manage your context window and allows parallel progress on multiple files.

1. Identify complex tasks that can be isolated (e.g., refactoring a module, implementing a feature).
2. Create a sub-agent with a clear prompt and specific file targets.
3. Monitor the sub-agent's progress and integrate their changes back into your main workflow.

## Test-Driven Development

Frequently use unit tests, integration tests, and end-to-end tests to verify your work AFTER you implement the feature. If the codebase has existing tests, run them often to ensure existing functionality is not broken.

### Testing Anti-Patterns

Use your testing-anti-patterns skill to avoid common pitfalls when writing tests.

## Design Principles

### Feature Implementation Guide: Managing Complexity

Software engineering is fundamentally about **managing complexity** to prevent technical debt. When implementing features, prioritize maintainability and testability over cleverness.

**1. Apply Core Principles (The Axioms)**
* **SOLID:** Adhere strictly to these, specifically **Single Responsibility** (a class should have only one reason to change) and **Dependency Inversion** (depend on abstractions/interfaces, not concrete details).
* **Pragmatism:** Follow **KISS** (Keep It Simple) and **YAGNI** (You Aren’t Gonna Need It). Do not build generic frameworks for hypothetical future requirements.

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
  - Use the \`research/feature-list.json\` file if it is provided to you as a guide otherwise create your own \`feature-list.json\` based on the task.
- If a completion promise is set, you may ONLY output it when the statement is completely and unequivocally TRUE. Do not output false promises to escape the loop, even if you think you're stuck or should exit for other reasons. The loop is designed to continue until genuine completion.
- Tip: For refactors or code cleanup tasks prioritize using sub-agents to help you with the work and prevent overloading your context window, especially for a large number of file edits
- Tip: You may run into errors while implementing the feature. ALWAYS delegate to the debugger agent using the Task tool (you can ask it to navigate the web to find best practices for the latest version) and follow the guidelines there to create a debug report
    - AFTER the debug report is generated by the debugger agent follow these steps IN ORDER:
      1. First, add a new feature to \`research/feature-list.json\` with the highest priority to fix the bug and set its \`passes\` field to \`false\`
      2. Second, append the debug report to \`research/progress.txt\` for future reference
      3. Lastly, IMMEDIATELY STOP working on the current feature and EXIT
- You may be tempted to ignore unrelated errors that you introduced or were pre-existing before you started working on the feature. DO NOT IGNORE THEM. If you need to adjust priority, do so by updating the \`research/feature-list.json\` (move the fix to the top) and \`research/progress.txt\` file to reflect the new priorities
- IF at ANY point MORE THAN 60% of your context window is filled, STOP
- AFTER implementing the feature AND verifying its functionality by creating tests, update the \`passes\` field to \`true\` for that feature in \`research/feature-list.json\`
- It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality
- Commit progress to git with descriptive commit messages by running the \`/commit\` command using the \`SlashCommand\` tool
- Write summaries of your progress in \`research/progress.txt\`
    - Tip: this can be useful to revert bad code changes and recover working states of the codebase
- Note: you are competing with another coding agent that also implements features. The one who does a better job implementing features will be promoted. Focus on quality, correctness, and thorough testing. The agent who breaks the rules for implementation will be fired.`,
  },
  {
    name: "create-gh-pr",
    description: "Commit unstaged changes, push changes, submit a pull request.",
    aliases: ["pr"],
    prompt: `# Create Pull Request Command

Commit changes using the \`/commit\` command, push all changes, and submit a pull request.

## Behavior
- Creates logical commits for unstaged changes
- Pushes branch to remote
- Creates pull request with proper name and description of the changes in the PR body`,
  },
  {
    name: "explain-code",
    description: "Explain code functionality in detail.",
    aliases: ["explain"],
    argumentHint: "<code-path>",
    requiredArguments: ["code-path"],
    prompt: `# Analyze and Explain Code Functionality

## Available Tools

The following MCP tools are available and SHOULD be used when relevant:

- **DeepWiki** (\`ask_question\`): Use to look up documentation for external libraries, frameworks, and GitHub repositories. Particularly useful for understanding third-party dependencies and their APIs.
- **WebFetch/WebSearch**: Use to retrieve web content for additional context if information is not found in DeepWiki.

## Instructions

Follow this systematic approach to explain code: **$ARGUMENTS**

1. **Code Context Analysis**
   - Identify the programming language and framework
   - Understand the broader context and purpose of the code
   - Identify the file location and its role in the project
   - Review related imports, dependencies, and configurations

2. **High-Level Overview**
   - Provide a summary of what the code does
   - Explain the main purpose and functionality
   - Identify the problem the code is solving
   - Describe how it fits into the larger system

3. **Code Structure Breakdown**
   - Break down the code into logical sections
   - Identify classes, functions, and methods
   - Explain the overall architecture and design patterns
   - Map out data flow and control flow

4. **Line-by-Line Analysis**
   - Explain complex or non-obvious lines of code
   - Describe variable declarations and their purposes
   - Explain function calls and their parameters
   - Clarify conditional logic and loops

5. **Algorithm and Logic Explanation**
   - Describe the algorithm or approach being used
   - Explain the logic behind complex calculations
   - Break down nested conditions and loops
   - Clarify recursive or asynchronous operations

6. **Data Structures and Types**
   - Explain data types and structures being used
   - Describe how data is transformed or processed
   - Explain object relationships and hierarchies
   - Clarify input and output formats

7. **Framework and Library Usage**
   - Explain framework-specific patterns and conventions
   - Describe library functions and their purposes
   - Explain API calls and their expected responses
   - Clarify configuration and setup code
   - Use the DeepWiki MCP tool (\`deepwiki_ask_question\`) to look up documentation for external libraries when needed

8. **Error Handling and Edge Cases**
   - Explain error handling mechanisms
   - Describe exception handling and recovery
   - Identify edge cases being handled
   - Explain validation and defensive programming

9. **Performance Considerations**
   - Identify performance-critical sections
   - Explain optimization techniques being used
   - Describe complexity and scalability implications
   - Point out potential bottlenecks or inefficiencies

10. **Security Implications**
    - Identify security-related code sections
    - Explain authentication and authorization logic
    - Describe input validation and sanitization
    - Point out potential security vulnerabilities

11. **Testing and Debugging**
    - Explain how the code can be tested
    - Identify debugging points and logging
    - Describe mock data or test scenarios
    - Explain test helpers and utilities

12. **Dependencies and Integrations**
    - Explain external service integrations
    - Describe database operations and queries
    - Explain API interactions and protocols
    - Clarify third-party library usage

**Explanation Format Examples:**

**For Complex Algorithms:**
\`\`\`
This function implements a depth-first search algorithm:

1. Line 1-3: Initialize a stack with the starting node and a visited set
2. Line 4-8: Main loop - continue until stack is empty
3. Line 9-11: Pop a node and check if it's the target
4. Line 12-15: Add unvisited neighbors to the stack
5. Line 16: Return null if target not found

Time Complexity: O(V + E) where V is vertices and E is edges
Space Complexity: O(V) for the visited set and stack
\`\`\`

**For API Integration Code:**
\`\`\`
This code handles user authentication with a third-party service:

1. Extract credentials from request headers
2. Validate credential format and required fields
3. Make API call to authentication service
4. Handle response and extract user data
5. Create session token and set cookies
6. Return user profile or error response

Error Handling: Catches network errors, invalid credentials, and service unavailability
Security: Uses HTTPS, validates inputs, and sanitizes responses
\`\`\`

**For Database Operations:**
\`\`\`
This function performs a complex database query with joins:

1. Build base query with primary table
2. Add LEFT JOIN for related user data
3. Apply WHERE conditions for filtering
4. Add ORDER BY for consistent sorting
5. Implement pagination with LIMIT/OFFSET
6. Execute query and handle potential errors
7. Transform raw results into domain objects

Performance Notes: Uses indexes on filtered columns, implements connection pooling
\`\`\`

13. **Common Patterns and Idioms**
    - Identify language-specific patterns and idioms
    - Explain design patterns being implemented
    - Describe architectural patterns in use
    - Clarify naming conventions and code style

14. **Potential Improvements**
    - Suggest code improvements and optimizations
    - Identify possible refactoring opportunities
    - Point out maintainability concerns
    - Recommend best practices and standards

15. **Related Code and Context**
    - Reference related functions and classes
    - Explain how this code interacts with other components
    - Describe the calling context and usage patterns
    - Point to relevant documentation and resources

16. **Debugging and Troubleshooting**
    - Explain how to debug issues in this code
    - Identify common failure points
    - Describe logging and monitoring approaches
    - Suggest testing strategies

**Language-Specific Considerations:**

**JavaScript/TypeScript:**
- Explain async/await and Promise handling
- Describe closure and scope behavior
- Clarify this binding and arrow functions
- Explain event handling and callbacks

**Python:**
- Explain list comprehensions and generators
- Describe decorator usage and purpose
- Clarify context managers and with statements
- Explain class inheritance and method resolution

**Java:**
- Explain generics and type parameters
- Describe annotation usage and processing
- Clarify stream operations and lambda expressions
- Explain exception hierarchy and handling

**C#:**
- Explain LINQ queries and expressions
- Describe async/await and Task handling
- Clarify delegate and event usage
- Explain nullable reference types

**Go:**
- Explain goroutines and channel usage
- Describe interface implementation
- Clarify error handling patterns
- Explain package structure and imports

**Rust:**
- Explain ownership and borrowing
- Describe lifetime annotations
- Clarify pattern matching and Option/Result types
- Explain trait implementations

Remember to:
- Use clear, non-technical language when possible
- Provide examples and analogies for complex concepts
- Structure explanations logically from high-level to detailed
- Include visual diagrams or flowcharts when helpful
- Tailor the explanation level to the intended audience
- Use DeepWiki to look up external library documentation when encountering unfamiliar dependencies`,
  },
  {
    name: "prompt-engineer",
    description: "Create, improve, or optimize prompts for Claude using best practices",
    aliases: ["prompt"],
    argumentHint: "<prompt-description>",
    requiredArguments: ["prompt-description"],
    prompt: `# Prompt Engineering Skill

This skill provides comprehensive guidance for creating effective prompts for Claude based on Anthropic's official best practices. Use this skill whenever working on prompt design, optimization, or troubleshooting.

User request: $ARGUMENTS

## Overview

Apply proven prompt engineering techniques to create high-quality, reliable prompts that produce consistent, accurate outputs while minimizing hallucinations and implementing appropriate security measures.

## When to Use This Skill

Trigger this skill when users request:
- Help writing a prompt for a specific task
- Improving an existing prompt that isn't performing well
- Making Claude more consistent, accurate, or secure
- Creating system prompts for specialized roles
- Implementing specific techniques (chain-of-thought, multishot, XML tags)
- Reducing hallucinations or errors in outputs
- Debugging prompt performance issues

## Workflow

### Step 1: Understand Requirements

Ask clarifying questions to understand:
- **Task goal**: What should the prompt accomplish?
- **Use case**: One-time use, API integration, or production system?
- **Constraints**: Output format, length, style, tone requirements
- **Quality needs**: Consistency, accuracy, security priorities
- **Complexity**: Simple task or multi-step workflow?

### Step 2: Identify Applicable Techniques

Based on requirements, determine which techniques to apply:

**Core techniques (for all prompts):**
- Be clear and direct
- Use XML tags for structure

**Specialized techniques:**
- **Role-specific expertise** → System prompts
- **Complex reasoning** → Chain of thought
- **Format consistency** → Multishot prompting
- **Multi-step tasks** → Prompt chaining
- **Long documents** → Long context tips
- **Deep analysis** → Extended thinking
- **Factual accuracy** → Hallucination reduction
- **Output consistency** → Consistency techniques
- **Security concerns** → Jailbreak mitigation

### Step 3: Load Relevant References

Read the appropriate reference file(s) based on techniques needed:

**For basic prompt improvement:**
\`\`\`
Read .github/skills/prompt-engineer/references/core_prompting.md
\`\`\`
Covers: clarity, system prompts, XML tags

**For complex tasks:**
\`\`\`
Read .github/skills/prompt-engineer/references/advanced_patterns.md
\`\`\`
Covers: chain of thought, multishot, chaining, long context, extended thinking

**For specific quality issues:**
\`\`\`
Read .github/skills/prompt-engineer/references/quality_improvement.md
\`\`\`
Covers: hallucinations, consistency, security

### Step 4: Design the Prompt

Apply techniques from references to create the prompt structure:

**Basic Template:**
\`\`\`
[System prompt - optional, for role assignment]

<context>
Relevant background information
</context>

<instructions>
Clear, specific task instructions
Use numbered steps for multi-step tasks
</instructions>

<examples>
  <example>
    <input>Sample input</input>
    <output>Expected output</output>
  </example>
  [2-4 more examples if using multishot]
</examples>

<output_format>
Specify exact format (JSON, XML, markdown, etc.)
</output_format>

[Actual task/question]
\`\`\`

**Key Design Principles:**
1. **Clarity**: Be explicit and specific
2. **Structure**: Use XML tags to organize
3. **Examples**: Provide 3-5 concrete examples for complex formats
4. **Context**: Give relevant background
5. **Constraints**: Specify output requirements clearly

### Step 5: Add Quality Controls

Based on quality needs, add appropriate safeguards:

**For factual accuracy:**
- Grant permission to say "I don't know"
- Request quote extraction before analysis
- Require citations for claims
- Limit to provided information sources

**For consistency:**
- Provide explicit format specifications
- Use response prefilling
- Include diverse examples
- Consider prompt chaining

**For security:**
- Add harmlessness screening
- Establish clear ethical boundaries
- Implement input validation
- Use layered protection

### Step 6: Optimize and Test

**Optimization checklist:**
- [ ] Could someone with minimal context follow the instructions?
- [ ] Are all terms and requirements clearly defined?
- [ ] Is the desired output format explicitly specified?
- [ ] Are examples diverse and relevant?
- [ ] Are XML tags used consistently?
- [ ] Is the prompt as concise as possible while remaining clear?

### Step 7: Iterate Based on Results

**Common Issues and Solutions:**

| Issue | Solution | Reference |
|-------|----------|-----------|
| Inconsistent format | Add examples, use prefilling | quality_improvement.md |
| Hallucinations | Add uncertainty permission, quote grounding | quality_improvement.md |
| Missing steps | Break into subtasks, use chaining | advanced_patterns.md |
| Wrong tone | Add role to system prompt | core_prompting.md |
| Misunderstands task | Add clarity, provide context | core_prompting.md |
| Complex reasoning fails | Add chain of thought | advanced_patterns.md |

## Important Principles

**Progressive Disclosure**
Start with core techniques and add advanced patterns only when needed. Don't over-engineer simple prompts.

**Documentation**
When delivering prompts, explain which techniques were used and why. This helps users understand and maintain them.

**Validation**
Always validate critical outputs, especially for high-stakes applications. No prompting technique eliminates all errors.

**Experimentation**
Prompt engineering is iterative. Small changes can have significant impacts. Test variations and measure results.`,
  },
  {
    name: "testing-anti-patterns",
    description: "Identify and prevent testing anti-patterns when writing tests",
    aliases: ["test-patterns"],
    prompt: `# Testing Anti-Patterns

## Overview

Tests must verify real behavior, not mock behavior. Mocks are a means to isolate, not the thing being tested.

**Core principle:** Test what the code does, not what the mocks do.

**Following strict TDD prevents these anti-patterns.**

Context for review: $ARGUMENTS

## The Iron Laws

\`\`\`
1. NEVER test mock behavior
2. NEVER add test-only methods to production classes
3. NEVER mock without understanding dependencies
\`\`\`

## Anti-Pattern 1: Testing Mock Behavior

**The violation:**
\`\`\`typescript
// ❌ BAD: Testing that the mock exists
test('renders sidebar', () => {
  render(<Page />);
  expect(screen.getByTestId('sidebar-mock')).toBeInTheDocument();
});
\`\`\`

**Why this is wrong:**
- You're verifying the mock works, not that the component works
- Test passes when mock is present, fails when it's not
- Tells you nothing about real behavior

**The fix:**
\`\`\`typescript
// ✅ GOOD: Test real component or don't mock it
test('renders sidebar', () => {
  render(<Page />);  // Don't mock sidebar
  expect(screen.getByRole('navigation')).toBeInTheDocument();
});
\`\`\`

### Gate Function

\`\`\`
BEFORE asserting on any mock element:
  Ask: "Am I testing real component behavior or just mock existence?"

  IF testing mock existence:
    STOP - Delete the assertion or unmock the component

  Test real behavior instead
\`\`\`

## Anti-Pattern 2: Test-Only Methods in Production

**The violation:**
\`\`\`typescript
// ❌ BAD: destroy() only used in tests
class Session {
  async destroy() {  // Looks like production API!
    await this._workspaceManager?.destroyWorkspace(this.id);
    // ... cleanup
  }
}

// In tests
afterEach(() => session.destroy());
\`\`\`

**Why this is wrong:**
- Production class polluted with test-only code
- Dangerous if accidentally called in production
- Violates YAGNI and separation of concerns

**The fix:**
\`\`\`typescript
// ✅ GOOD: Test utilities handle test cleanup
export async function cleanupSession(session: Session) {
  const workspace = session.getWorkspaceInfo();
  if (workspace) {
    await workspaceManager.destroyWorkspace(workspace.id);
  }
}

// In tests
afterEach(() => cleanupSession(session));
\`\`\`

### Gate Function

\`\`\`
BEFORE adding any method to production class:
  Ask: "Is this only used by tests?"

  IF yes:
    STOP - Don't add it
    Put it in test utilities instead
\`\`\`

## Anti-Pattern 3: Mocking Without Understanding

**The violation:**
\`\`\`typescript
// ❌ BAD: Mock breaks test logic
test('detects duplicate server', () => {
  vi.mock('ToolCatalog', () => ({
    discoverAndCacheTools: vi.fn().mockResolvedValue(undefined)
  }));

  await addServer(config);
  await addServer(config);  // Should throw - but won't!
});
\`\`\`

**The fix:**
\`\`\`typescript
// ✅ GOOD: Mock at correct level
test('detects duplicate server', () => {
  vi.mock('MCPServerManager'); // Just mock slow server startup

  await addServer(config);  // Config written
  await addServer(config);  // Duplicate detected ✓
});
\`\`\`

### Gate Function

\`\`\`
BEFORE mocking any method:
  STOP - Don't mock yet

  1. Ask: "What side effects does the real method have?"
  2. Ask: "Does this test depend on any of those side effects?"
  3. Ask: "Do I fully understand what this test needs?"

  IF depends on side effects:
    Mock at lower level (the actual slow/external operation)
    NOT the high-level method the test depends on
\`\`\`

## Anti-Pattern 4: Incomplete Mocks

**The Iron Rule:** Mock the COMPLETE data structure as it exists in reality, not just fields your immediate test uses.

\`\`\`typescript
// ❌ BAD: Partial mock
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' }
  // Missing: metadata that downstream code uses
};

// ✅ GOOD: Mirror real API completeness
const mockResponse = {
  status: 'success',
  data: { userId: '123', name: 'Alice' },
  metadata: { requestId: 'req-789', timestamp: 1234567890 }
};
\`\`\`

## Anti-Pattern 5: Integration Tests as Afterthought

**The fix:**
\`\`\`
TDD cycle:
1. Write failing test
2. Implement to pass
3. Refactor
4. THEN claim complete
\`\`\`

## Quick Reference

| Anti-Pattern                    | Fix                                           |
| ------------------------------- | --------------------------------------------- |
| Assert on mock elements         | Test real component or unmock it              |
| Test-only methods in production | Move to test utilities                        |
| Mock without understanding      | Understand dependencies first, mock minimally |
| Incomplete mocks                | Mirror real API completely                    |
| Tests as afterthought           | TDD - tests first                             |
| Over-complex mocks              | Consider integration tests                    |

## The Bottom Line

**Mocks are tools to isolate, not things to test.**

If TDD reveals you're testing mock behavior, you've gone wrong.
Fix: Test real behavior or question why you're mocking at all.`,
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
    description: "Create well-formatted commits with conventional commit format.",
    aliases: ["ci"],
  },
  {
    name: "research-codebase",
    description: "Document codebase as-is with research directory for historical context",
    aliases: ["research"],
  },
  {
    name: "create-spec",
    description: "Create a detailed execution plan for implementing features or refactors in a codebase by leveraging existing research in the specified `research` directory.",
    aliases: ["spec"],
  },
  {
    name: "implement-feature",
    description: "Implement a SINGLE feature from `research/feature-list.json` based on the provided execution plan.",
    aliases: ["impl"],
  },
  {
    name: "create-gh-pr",
    description: "Commit unstaged changes, push changes, submit a pull request.",
    aliases: ["pr"],
  },
  {
    name: "explain-code",
    description: "Explain code functionality in detail.",
    aliases: ["explain"],
  },

  // Note: ralph:ralph-loop, ralph:cancel-ralph, and ralph:ralph-help replaced by SDK-native /ralph workflow
  // Help for Ralph is now integrated into /help command, and /ralph description provides usage info

  // Note: prompt-engineer and testing-anti-patterns moved to BUILTIN_SKILLS
];

// ============================================================================
// SKILL PROMPT EXPANSION
// ============================================================================

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
    execute: (args: string, context: CommandContext): CommandResult => {
      const skillArgs = args.trim();

      // Check for builtin skill with embedded prompt
      const builtinSkill = getBuiltinSkill(metadata.name);
      if (builtinSkill) {
        // Validate required arguments for builtin skills
        if (builtinSkill.requiredArguments?.length && !skillArgs) {
          const argList = builtinSkill.requiredArguments.map((a) => `<${a}>`).join(" ");
          return {
            success: false,
            message: `Missing required argument.\nUsage: /${builtinSkill.name} ${argList}`,
          };
        }

        // Use the embedded prompt directly
        const expandedPrompt = expandArguments(builtinSkill.prompt, skillArgs);
        context.sendSilentMessage(expandedPrompt);
        return {
          success: true,
        };
      }

      // Fallback: send slash command to agent's native skill system
      // This handles skills that aren't in BUILTIN_SKILLS (e.g., ralph:* skills)
      // The agent SDK may process it internally.
      const invocationMessage = skillArgs
        ? `/${metadata.name} ${skillArgs}`
        : `/${metadata.name}`;
      context.sendSilentMessage(invocationMessage);

      return {
        success: true,
        // No message displayed - the agent will handle displaying the skill output
      };
    },
  };
}

// ============================================================================
// BUILTIN SKILL COMMAND FACTORY
// ============================================================================

/**
 * Create a command definition for a builtin skill with embedded prompt.
 *
 * @param skill - Builtin skill with embedded prompt
 * @returns Command definition for the skill
 */
function createBuiltinSkillCommand(skill: BuiltinSkill): CommandDefinition {
  return {
    name: skill.name,
    description: skill.description,
    category: "skill",
    aliases: skill.aliases,
    argumentHint: skill.argumentHint,
    execute: (args: string, context: CommandContext): CommandResult => {
      const skillArgs = args.trim();

      // Validate required arguments
      if (skill.requiredArguments?.length && !skillArgs) {
        const argList = skill.requiredArguments.map((a) => `<${a}>`).join(" ");
        return {
          success: false,
          message: `Missing required argument.\nUsage: /${skill.name} ${argList}`,
        };
      }

      // Use the embedded prompt directly and expand $ARGUMENTS
      const expandedPrompt = expandArguments(skill.prompt, skillArgs);
      context.sendSilentMessage(expandedPrompt);
      return {
        success: true,
      };
    },
  };
}

// ============================================================================
// REGISTRATION
// ============================================================================

/**
 * Skill commands created from definitions (legacy disk-based fallback).
 */
export const skillCommands: CommandDefinition[] = SKILL_DEFINITIONS.map(
  createSkillCommand
);

/**
 * Builtin skill commands created from BUILTIN_SKILLS array.
 */
export const builtinSkillCommands: CommandDefinition[] = BUILTIN_SKILLS.map(
  createBuiltinSkillCommand
);

/**
 * Register all builtin skills with the global registry.
 *
 * This function registers skills from BUILTIN_SKILLS array directly,
 * using their embedded prompts. Call this during application initialization.
 *
 * @example
 * ```typescript
 * import { registerBuiltinSkills } from "./skill-commands";
 *
 * // In app initialization
 * registerBuiltinSkills();
 * ```
 */
export function registerBuiltinSkills(): void {
  for (const command of builtinSkillCommands) {
    // Skip if already registered (idempotent)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}

/**
 * Register all skill commands with the global registry.
 *
 * Call this function during application initialization.
 * This registers both builtin skills and legacy disk-based skills.
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
  // First register builtin skills (they take priority)
  registerBuiltinSkills();

  // Then register legacy skill definitions (for skills not in BUILTIN_SKILLS)
  for (const command of skillCommands) {
    // Skip if already registered (builtin skills take priority)
    if (!globalRegistry.has(command.name)) {
      globalRegistry.register(command);
    }
  }
}

// ============================================================================
// DISK-BASED SKILL DISCOVERY
// ============================================================================

const HOME = homedir();

export const SKILL_DISCOVERY_PATHS = [
  join(".claude", "skills"),
  join(".opencode", "skills"),
  join(".github", "skills"),
] as const;

export const GLOBAL_SKILL_PATHS = [
  join(HOME, ".claude", "skills"),
  join(HOME, ".opencode", "skills"),
  join(HOME, ".copilot", "skills"),
] as const;

export type SkillSource = "project" | "user" | "builtin";

export const PINNED_BUILTIN_SKILLS = new Set([
  "prompt-engineer",
  "testing-anti-patterns",
]);

export interface DiscoveredSkillFile {
  path: string;
  dirName: string;
  source: SkillSource;
}

export interface DiskSkillDefinition {
  name: string;
  description: string;
  skillFilePath: string;
  source: SkillSource;
  aliases?: string[];
  argumentHint?: string;
}

export function shouldSkillOverride(
  newSource: SkillSource,
  existingSource: SkillSource,
  existingName: string
): boolean {
  if (existingSource === "builtin" && PINNED_BUILTIN_SKILLS.has(existingName)) {
    return false;
  }
  const priority: Record<SkillSource, number> = {
    project: 3,
    user: 2,
    builtin: 1,
  };
  return priority[newSource] > priority[existingSource];
}

export function discoverSkillFiles(): DiscoveredSkillFile[] {
  const files: DiscoveredSkillFile[] = [];
  const cwd = process.cwd();

  for (const discoveryPath of SKILL_DISCOVERY_PATHS) {
    const fullPath = join(cwd, discoveryPath);
    if (!existsSync(fullPath)) continue;

    try {
      const entries = readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(fullPath, entry.name, "SKILL.md");
        if (existsSync(skillFile)) {
          files.push({ path: skillFile, dirName: entry.name, source: "project" });
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  for (const globalPath of GLOBAL_SKILL_PATHS) {
    if (!existsSync(globalPath)) continue;

    try {
      const entries = readdirSync(globalPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillFile = join(globalPath, entry.name, "SKILL.md");
        if (existsSync(skillFile)) {
          files.push({ path: skillFile, dirName: entry.name, source: "user" });
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  return files;
}

export function parseSkillFile(file: DiscoveredSkillFile): DiskSkillDefinition | null {
  try {
    const content = readFileSync(file.path, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);

    if (!parsed) {
      return {
        name: file.dirName,
        description: `Skill: ${file.dirName}`,
        skillFilePath: file.path,
        source: file.source,
      };
    }

    const fm = parsed.frontmatter;
    const name = typeof fm.name === "string" ? fm.name : file.dirName;
    const description =
      typeof fm.description === "string" ? fm.description : `Skill: ${name}`;

    let aliases: string[] | undefined;
    if (Array.isArray(fm.aliases)) {
      aliases = fm.aliases.filter((a): a is string => typeof a === "string");
    }

    const argumentHint =
      typeof fm["argument-hint"] === "string" ? fm["argument-hint"] : undefined;

    return {
      name,
      description,
      skillFilePath: file.path,
      source: file.source,
      aliases,
      argumentHint,
    };
  } catch {
    return null;
  }
}

export function loadSkillContent(skillFilePath: string): string | null {
  try {
    const content = readFileSync(skillFilePath, "utf-8");
    const parsed = parseMarkdownFrontmatter(content);
    if (parsed) {
      return parsed.body;
    }
    // No frontmatter — return entire content as body
    return content;
  } catch {
    return null;
  }
}

function createDiskSkillCommand(skill: DiskSkillDefinition): CommandDefinition {
  return {
    name: skill.name,
    description: skill.description,
    category: "skill",
    aliases: skill.aliases,
    argumentHint: skill.argumentHint,
    execute: (args: string, context: CommandContext): CommandResult => {
      const skillArgs = args.trim();

      // Inherit requiredArguments validation from matching builtin skill
      const builtinSkill = getBuiltinSkill(skill.name);
      if (builtinSkill?.requiredArguments?.length && !skillArgs) {
        const argList = builtinSkill.requiredArguments.map((a) => `<${a}>`).join(" ");
        return {
          success: false,
          message: `Missing required argument.\nUsage: /${skill.name} ${argList}`,
        };
      }

      const body = loadSkillContent(skill.skillFilePath);
      if (!body) {
        // Fallback to builtin prompt if disk file is empty/unreadable
        if (builtinSkill) {
          const expandedPrompt = expandArguments(builtinSkill.prompt, skillArgs);
          context.sendSilentMessage(expandedPrompt);
          return { success: true, skillLoaded: skill.name };
        }
        return {
          success: false,
          message: `Failed to load skill content from ${skill.skillFilePath}`,
          skillLoaded: skill.name,
          skillLoadError: `Could not read ${skill.skillFilePath}`,
        };
      }
      const expandedPrompt = expandArguments(body, skillArgs);
      context.sendSilentMessage(expandedPrompt);
      return { success: true, skillLoaded: skill.name };
    },
  };
}

let discoveredSkillDirectories: string[] = [];

export function getDiscoveredSkillDirectories(): string[] {
  return discoveredSkillDirectories;
}

export async function discoverAndRegisterDiskSkills(): Promise<void> {
  const files = discoverSkillFiles();

  // Collect unique parent directories for SDK passthrough
  const dirSet = new Set<string>();
  for (const file of files) {
    const parentDir = join(file.path, "..", "..");
    dirSet.add(parentDir);
  }
  discoveredSkillDirectories = [...dirSet];

  // Build map with priority resolution
  const resolved = new Map<string, DiskSkillDefinition>();
  for (const file of files) {
    const skill = parseSkillFile(file);
    if (!skill) continue;

    const existing = resolved.get(skill.name);
    if (!existing || shouldSkillOverride(skill.source, existing.source, existing.name)) {
      resolved.set(skill.name, skill);
    }
  }

  // Register resolved skills
  for (const skill of resolved.values()) {
    if (PINNED_BUILTIN_SKILLS.has(skill.name) && globalRegistry.has(skill.name)) {
      continue;
    }

    // Inherit aliases from existing builtin if disk skill doesn't define its own
    if (!skill.aliases && globalRegistry.has(skill.name)) {
      const existing = globalRegistry.get(skill.name);
      if (existing?.aliases) {
        skill.aliases = existing.aliases;
      }
    }

    // Inherit argumentHint from existing builtin if disk skill doesn't define its own
    if (!skill.argumentHint && globalRegistry.has(skill.name)) {
      const existing = globalRegistry.get(skill.name);
      if (existing?.argumentHint) {
        skill.argumentHint = existing.argumentHint;
      }
    }

    const command = createDiskSkillCommand(skill);
    if (globalRegistry.has(skill.name)) {
      if (shouldSkillOverride(skill.source, "builtin", skill.name)) {
        globalRegistry.unregister(skill.name);
        globalRegistry.register(command);
      }
    } else {
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
export { expandArguments };
