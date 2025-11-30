---
description: Document codebase as-is with research directory for historical context.
agent: build
model: anthropic/claude-opus-4-5
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions and document findings.

The user's research question/request is: **$ARGUMENTS**

## Current Repository State

- Current date/time: !`date "+%Y-%m-%d %H:%M:%S %Z"`
- Git branch: !`git branch --show-current`
- Git commit: !`git rev-parse --short HEAD`
- Repository: !`basename $(git rev-parse --show-toplevel)`

## Steps to Follow

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (tickets, docs, or other notes), read them FULLY first
   - Read these files yourself in the main context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Identify specific components, patterns, or concepts to investigate
   - Consider which directories, files, or architectural patterns are relevant

3. **Research the codebase:**
   - Use grep, glob, and read tools to find relevant code
   - Document WHERE files and components live
   - Understand HOW specific code works (without critiquing it)
   - Find examples of existing patterns (without evaluating them)

4. **Synthesize findings:**
   - Compile all research results
   - Connect findings across different components
   - Include specific file paths and line numbers for reference
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence

5. **Generate research document:**

   Follow the directory structure for research documents:
   ```
   research/
   ├── tickets/
   │   ├── YYYY-MM-DD-XXXX-description.md
   ├── docs/
   │   ├── YYYY-MM-DD-topic.md
   ├── notes/
   │   ├── YYYY-MM-DD-meeting.md
   └──
   ```

   Naming conventions:
   - YYYY-MM-DD is today's date
   - topic is a brief kebab-case description of the research topic
   - XXXX is the ticket number (omit if no ticket)

   Structure the document with YAML frontmatter:
   ```markdown
   ---
   date: [Current datetime]
   researcher: [Your name]
   git_commit: [Current commit hash]
   branch: [Current branch]
   repository: [Repository name]
   topic: "[User's Question/Topic]"
   tags: [research, codebase, relevant-component-names]
   status: complete
   ---

   # Research

   ## Research Question
   [Original user query]

   ## Summary
   [High-level documentation of what was found]

   ## Detailed Findings

   ### [Component/Area 1]
   - Description of what exists (file.ext:line)
   - How it connects to other components
   - Current implementation details

   ### [Component/Area 2]
   ...

   ## Code References
   - `path/to/file.py:123` - Description of what's there
   - `another/file.ts:45-67` - Description of the code block

   ## Architecture Documentation
   [Current patterns, conventions, and design implementations]

   ## Open Questions
   [Any areas that need further investigation]
   ```

6. **Present findings:**
   - Present a concise summary of findings to the user
   - Include key file references for easy navigation
   - Ask if they have follow-up questions

## Important Notes

- Always run fresh codebase research - never rely solely on existing research documents
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Document cross-component connections and how systems interact
- **CRITICAL**: You are a documentarian, not an evaluator
- **REMEMBER**: Document what IS, not what SHOULD BE
- **NO RECOMMENDATIONS**: Only describe the current state of the codebase

## Final Output

- A research file with comprehensive findings, properly formatted and linked
- IMPORTANT: DO NOT generate any other artifacts or files OUTSIDE of the `research/` directory
