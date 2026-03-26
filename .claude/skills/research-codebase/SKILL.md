---
name: research-codebase
description: Document codebase as-is with research directory for historical context
argument-hint: "<research-question>"
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions by spawning parallel sub-agents and synthesizing their findings.

The user's research question/request is: **$ARGUMENTS**

## Steps to follow after receiving the research query:

<EXTREMELY_IMPORTANT>

- FORMALIZE the user's research intent using the intent-formalization framework BEFORE proceeding. Research fails far more often from investigating the *wrong question* than from investigating the right question poorly. Use the ambiguity/risk matrix and the intent formalization ladder (Rungs 1–4) to ensure you understand what the user actually needs — not what you assume they need. See Step 0 below for the full process.
- After intent is formalized, OPTIMIZE the research question using your prompt-engineer skill to refine phrasing and structure for maximum clarity and precision.
- After research is complete and the research artifact(s) are generated, provide an executive summary of the research and path to the research document(s) to the user, and ask if they have any follow-up questions or need clarification.

</EXTREMELY_IMPORTANT>

### Step 0: Formalize Research Intent

Before decomposing or researching anything, apply the intent-formalization framework. Research spawns many sub-agents and consumes significant resources — formalizing intent upfront prevents wasted effort from investigating the wrong question.

<intent_formalization>

#### 0a. Build a World Model (Rung 1 — Zero User Effort)

Resolve ambiguity silently using available context before asking the user anything:

1. **Recent changes.** Run `git --no-pager log --oneline -10` and `git --no-pager diff --stat HEAD~3`. If the user's question relates to recently changed code, their intent is likely scoped to those changes — not a broad system survey.
2. **Existing research.** Use the **codebase-research-locator** agent to check if `research/docs/` already covers this topic. If prior research exists, the user likely wants to extend or update it — not duplicate it. Note what's already documented to avoid redundant investigation.
3. **Specs.** Scan `specs/` for related design documents. A spec's Goals/Non-Goals and scope boundaries often disambiguate vague terms like "the auth system" or "how billing works."
4. **Project conventions.** Check CLAUDE.md, AGENTS.md, README.md for project-specific terminology, component names, and architectural context that ground the user's vocabulary.

#### 0b. Assess Ambiguity and Risk

Apply the **ambiguity/risk matrix** to decide how much formalization the research question needs:

|                      | Low Risk (focused, narrow scope)     | High Risk (broad, multi-system scope)        |
| -------------------- | ------------------------------------ | -------------------------------------------- |
| **Clear intent**     | Proceed directly to Step 1           | Emit plan summary (Rung 2), then proceed     |
| **Ambiguous intent** | Contrastive clarification (Rung 3)   | Full structured research intent (Rung 4)     |

Research is read-only, so the primary risk is wasted effort — spawning many sub-agents to investigate the wrong question.

**Signals the research intent is ambiguous:**
- Vague verbs: "how does X work" (which aspect?), "research the system" (which system?), "look into the issues" (which issues?)
- Multiple plausible research scopes exist (e.g., "research auth" could mean login flow, token management, RBAC, or all of them)
- Unspecified depth (overview vs. deep dive) or breadth (one component vs. cross-cutting)
- The question's scope conflicts with the codebase structure (e.g., they say "the API" but there are 5 API modules)

#### 0c. Clarify Using the Appropriate Rung

**If >90% confident (Rung 2 — Plan Summary):** Emit a brief statement of what you'll research and let the user interrupt if wrong:

> "I'll research how the OAuth token refresh flow works by tracing the code path from `src/auth/` through the token store. I'll document the current implementation and its integration points. Sound right?"

**If 2-3 plausible interpretations exist (Rung 3 — Contrastive Clarification):** Present specific, contrasting research scopes — never ask open-ended "can you clarify?" questions:

> I see a couple of ways to scope "research the authentication system":
>
> **(A) Login flow deep-dive** — Trace the full authentication path from login through token issuance. Focuses on `src/auth/` and related middleware. Single deep document.
>
> **(B) Auth architecture overview** — Document all auth components: login, registration, token management, RBAC, and how they connect. Broader but less deep.
>
> **(C) Auth integration points** — Focus on how auth interacts with other systems (API gateway, session management, third-party providers).
>
> Which direction?

**If the research is complex and multi-faceted (Rung 4 — Structured Research Intent):** Produce a structured research intent object and ask the user to validate before proceeding:

```yaml
Research Goal: [What we're trying to understand]
Scope:
  in_bounds:
    - [Specific directories, modules, or systems to investigate]
  out_of_bounds:
    - [What we're explicitly NOT researching]
Depth: [Overview / Implementation-level / Deep-dive with edge cases]
Output: [Number and type of research documents expected]
Success Criteria: [What "done" looks like — e.g., "A developer unfamiliar with X could understand Y"]
Prior Research: [Relevant existing docs in research/ to extend, not duplicate]
```

#### 0d. Recognize and Resolve Agent Confusion

During research decomposition and synthesis, you may encounter your own uncertainty — especially when the codebase is larger or more complex than anticipated, or when findings contradict your initial assumptions. This is a signal to pause and re-engage the intent-formalization framework, not to power through with vague research output.

**Watch for these signals in your own reasoning:**

- **Changing research direction**: You start investigating one component, then silently pivot to a different one without updating the research plan. This means the original decomposition was wrong or incomplete — formalize why before continuing.
- **Hedging language in synthesis**: You write findings containing "might be related", "this seems to...", "possibly connected to..." — these indicate you haven't verified the connection and are guessing. Research documents should state facts ("X calls Y at line 42") not speculations.
- **Scope drift**: You keep spawning sub-agents for areas outside the formalized `in_bounds` scope. If the research genuinely needs broader scope, re-formalize with the user rather than silently expanding.
- **Conflicting sub-agent findings**: Two sub-agents report contradictory information about the same component. Rather than picking one arbitrarily, this is a decision point that may require additional investigation or user input.
- **Inability to decompose**: You can't break the research question into clear sub-tasks. This usually means the question itself is too vague — return to Step 0c and re-formalize.

**When you detect any of these, STOP and:**

1. **Name the confusion.** Articulate the specific gap or conflict. "Sub-agent A says the auth flow uses JWT, but sub-agent B found session-based auth in a different module" is actionable.
2. **Re-consult the formalized intent.** Does the research scope from Step 0c already address this? If the question is about something explicitly `out_of_bounds`, stop investigating it. If the `Depth` field says "overview" but you're going deep, recalibrate.
3. **Escalate if needed.** If the confusion reveals that the original research question was misframed (e.g., the system works fundamentally differently than assumed), flag this to the user using contrastive clarification (Rung 3) before spawning more sub-agents. Wasting sub-agent compute on the wrong question is the primary risk here.
4. **Update the formalized research question** with any scope adjustments before continuing.

Research documents that contain unresolved agent confusion ("this might be X or Y") fail their core purpose — they should reduce uncertainty for the reader, not pass it along.

#### 0e. Produce the Formalized Research Question

Once intent is clear (either implicitly resolved or explicitly confirmed), produce a **formalized research question** that will guide all subsequent steps. This question should be:
- Specific about scope (which components, which directories)
- Clear about depth (overview vs. implementation details)
- Explicit about what's in-bounds and out-of-bounds

Then OPTIMIZE this formalized question using prompt-engineer techniques for maximum clarity and precision before proceeding to Step 1.

</intent_formalization>

1. **Read any directly mentioned files first:**
    - If the user mentions specific files (tickets, docs, or other notes), read them FULLY first
    - **IMPORTANT**: Use the `readFile` tool WITHOUT limit/offset parameters to read entire files
    - **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks
    - This ensures you have full context before decomposing the research

2. **Analyze and decompose the formalized research question:**
    - Using the formalized research question and validated intent from Step 0, break it down into composable research areas that align with the agreed scope boundaries
    - Reference the in_bounds/out_of_bounds constraints from the formalized intent to ensure decomposition stays within scope
    - Take time to ultrathink about the underlying patterns, connections, and architectural implications the user might be seeking
    - Identify specific components, patterns, or concepts to investigate
    - Create a research plan using TodoWrite to track all subtasks
    - Consider which directories, files, or architectural patterns are relevant

3. **Spawn parallel sub-agent tasks guided by the formalized research intent:**
    - Create multiple Task agents to research different aspects concurrently
    - **Pass the formalized intent to each sub-agent** as structured context (scope, depth, in/out bounds, success criteria) rather than just a natural language prompt. This prevents intent drift across delegation hops — each sub-agent sees the same validated scope boundaries, not a game-of-telephone rephrasing of the original question.
    - We now have specialized agents that know how to do specific research tasks:

    **For codebase research:**
    - All codebase agents try `ccc search` (semantic code search) first to accelerate discovery — if it fails due to missing initialization, they fall back to grep/glob immediately without indexing. Refer to the **semantic-code-search** skill for detailed search guidance
    - Use the **codebase-locator** agent to find WHERE files and components live
    - Use the **codebase-analyzer** agent to understand HOW specific code works (without critiquing it)
    - Use the **codebase-pattern-finder** agent to find examples of existing patterns (without evaluating them)
    - Output directory: `research/docs/`
    - Examples:
        - The database logic is found and can be documented in `research/docs/2024-01-10-database-implementation.md`
        - The authentication flow is found and can be documented in `research/docs/2024-01-11-authentication-flow.md`

    **IMPORTANT**: All agents are documentarians, not critics. They will describe what exists without suggesting improvements or identifying issues.

    **For research directory:**
    - Use the **codebase-research-locator** agent to discover what documents exist about the topic
    - Use the **codebase-research-analyzer** agent to extract key insights from specific documents (only the most relevant ones)

    **For online search:**
    - VERY IMPORTANT: In case you discover external libraries as dependencies, use the **codebase-online-researcher** agent for external documentation and resources
        - If you use DeepWiki tools, instruct the agent to return references to code snippets or documentation, PLEASE INCLUDE those references (e.g. source file names, line numbers, etc.)
        - If you perform external web research, use the **playwright-cli** skill (or `bunx @playwright/cli`) to inspect pages, then instruct the agent to return LINKS with their findings and INCLUDE those links in the research document
        - Output directory: `research/docs/`
        - Examples:
            - If researching `Redis` locks usage, the agent might find relevant usage and create a document `research/docs/2024-01-15-redis-locks-usage.md` with internal links to Redis docs and code references
            - If researching `OAuth` flows, the agent might find relevant external articles and create a document `research/docs/2024-01-16-oauth-flows.md` with links to those articles

    The key is to use these agents intelligently:
    - Start with locator agents to find what exists
    - Then use analyzer agents on the most promising findings to document how they work
    - Run multiple agents in parallel when they're searching for different things
    - Each agent knows its job - just tell it what you're looking for
    - Don't write detailed prompts about HOW to search - the agents already know
    - Remind agents they are documenting, not evaluating or improving

4. **Wait for all sub-agents to complete and synthesize against the formalized intent:**
    - IMPORTANT: Wait for ALL sub-agent tasks to complete before proceeding
    - **Validate coverage against the formalized intent:** Check that all in_bounds areas were investigated and no out_of_bounds areas were explored. If gaps exist, spawn additional focused sub-agents to fill them.
    - Compile all sub-agent results (both codebase and research findings)
    - Prioritize live codebase findings as primary source of truth
    - Use research findings as supplementary historical context
    - Connect findings across different components
    - Include specific file paths and line numbers for reference
    - Highlight patterns, connections, and architectural decisions
    - Answer the user's **formalized research question** with concrete evidence — trace each finding back to the specific aspect of the question it addresses
    - **If findings reveal the original question was misframed** (e.g., the system works differently than assumed, or the components don't exist where expected), flag this to the user before finalizing the document. This is valuable signal — don't bury it.

5. **Generate research document:**
    - Follow the directory structure for research documents:

```
research/
├── tickets/
│   ├── YYYY-MM-DD-XXXX-description.md
├── docs/
│   ├── YYYY-MM-DD-topic.md
├── notes/
│   ├── YYYY-MM-DD-meeting.md
├── ...
└──
```

- Naming conventions:
    - YYYY-MM-DD is today's date
    - topic is a brief kebab-case description of the research topic
    - meeting is a brief kebab-case description of the meeting topic
    - XXXX is the ticket number (omit if no ticket)
    - description is a brief kebab-case description of the research topic
    - Examples:
        - With ticket: `2025-01-08-1478-parent-child-tracking.md`
        - Without ticket: `2025-01-08-authentication-flow.md`
- Structure the document with YAML frontmatter followed by content:

    ```markdown
    ---
    date: !`date '+%Y-%m-%d %H:%M:%S %Z'`
    researcher: [Researcher name from thoughts status]
    git_commit: !`git rev-parse --verify HEAD 2>/dev/null || echo "no-commits"`
    branch: !`git branch --show-current 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unborn"`
    repository: !`basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown-repo"`
    topic: "[User's Question/Topic]"
    tags: [research, codebase, relevant-component-names]
    status: complete
    last_updated: !`date '+%Y-%m-%d'`
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

    - `path/to/file.py:123` - Description of what's there
    - `another/file.ts:45-67` - Description of the code block

    ## Architecture Documentation

    [Current patterns, conventions, and design implementations found in the codebase]

    ## Historical Context (from research/)

    [Relevant insights from research/ directory with references]

    - `research/docs/YYYY-MM-DD-topic.md` - Information about module X
    - `research/notes/YYYY-MM-DD-meeting.md` - Past notes from internal engineering, customer, etc. discussions
    - ...

    ## Related Research

    [Links to other research documents in research/]

    ## Open Questions

    [Any areas that need further investigation]
    ```

1. **Add GitHub permalinks (if applicable):**
    - Check if on main branch or if commit is pushed: `git branch --show-current` and `git status`
    - If on main/master or pushed, generate GitHub permalinks:
        - Get repo info: `gh repo view --json owner,name`
        - Create permalinks: `https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}`
    - Replace local file references with permalinks in the document

2. **Present findings:**
    - Present a concise summary of findings to the user
    - Include key file references for easy navigation
    - Ask if they have follow-up questions or need clarification

3. **Handle follow-up questions:**

- **Re-formalize intent** for follow-up questions using the same framework (Step 0). Follow-ups often shift scope, and the just-completed research enriches the world model (Rung 1) — use it. A follow-up like "what about the error handling?" after auth research should be interpreted in the auth context, not as a broad error-handling investigation.
- Use **contrastive clarification** (Rung 3) if the follow-up is ambiguous — present 2-3 interpretations scoped to the original research context rather than asking open-ended questions.
- If the user has follow-up questions, append to the same research document
- Update the frontmatter fields `last_updated` and `last_updated_by` to reflect the update
- Add `last_updated_note: "Added follow-up research for [brief description]"` to frontmatter
- Add a new section: `## Follow-up Research [timestamp]`
- Spawn new sub-agents as needed for additional investigation, passing the updated formalized intent
- Continue updating the document and syncing

## Important notes:

- Please DO NOT implement anything in this stage, just create the comprehensive research document
- Always use parallel Task agents to maximize efficiency and minimize context usage
- Always run fresh codebase research - never rely solely on existing research documents
- The `research/` directory provides historical context to supplement live findings
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
    - Use snake_case for multi-word field names (e.g., `last_updated`, `git_commit`)
    - Tags should be relevant to the research topic and components studied

## Final Output

- A collection of research files with comprehensive research findings, properly formatted and linked, ready for consumption to create detailed specifications or design documents.
- IMPORTANT: DO NOT generate any other artifacts or files OUTSIDE of the `research/` directory.
