# Atomic `/context-compact` Technical Design Document / RFC

| Document Metadata      | Details                                   |
| ---------------------- | ----------------------------------------- |
| Author(s)              | Alex Lavaee                               |
| Status                 | Draft (WIP; updated after review round 6) |
| Team / Owner           | Atomic CLI / Coding Agent maintainers     |
| Created / Last Updated | 2026-06-06 / 2026-06-06                   |

## 1. Executive Summary

This RFC proposes adding a fixed no-argument builtin slash command, `/context-compact`, for deletion-based verbatim compaction in `@bastani/atomic`. Unlike `/compact [prompt]`, which asks the selected model to generate a structured summary, `/context-compact` asks the selected model for deletion targets over stable transcript entry IDs/content blocks, validates that plan, and lets Atomic apply only deletions so retained transcript content remains verbatim.

The core doors are `invoke_context_compact`, `build_context_compaction_view`, `validate_context_deletion_plan`, `get_latest_compaction_boundary`, `respect_llm_context_exclusion`, `include_summary_compaction_context`, `filter_branch_summary_context`, `estimate_image_block_tokens`, and `accept_compaction_summary_task_context`.

Review round 6 adds three corrections: image content-block deletions must use image-sized token estimates, branch summarization must honor logical context deletions before calling the branch-summary model, and validation must accept a protected `compactionSummary` as task-bearing context when no raw user message survives.

## 2. Context and Motivation

Issue / PRD: [bastani-inc/atomic#1274](https://github.com/bastani-inc/atomic/issues/1274), “Add /context-compact builtin verbatim compaction command.”

Reference methodology: <https://www.morphllm.com/context-compaction>, which defines strict context compaction as deletion-based reduction where surviving content remains unchanged.

Investigation notes:
- GitHub issue body and both attached screenshots were readable. OCR confirmed the issue’s deletion/preservation categories.
- No issue comments were present when inspected.
- Latest review artifact inspected: `/var/folders/cr/lt2lnmhd0g7c3g_62423frp80000gn/T/atomic-ralph-run-V7sBPp/review-round-6.json`.

### 2.1 Current State

**Architecture:**
- Builtin slash commands are listed in `packages/coding-agent/src/core/slash-commands.ts` via `BUILTIN_SLASH_COMMANDS`.
- Interactive `/compact` is handled in `packages/coding-agent/src/modes/interactive/interactive-mode.ts`.
- Manual summary compaction enters `AgentSession.compact(customInstructions?)` in `packages/coding-agent/src/core/agent-session.ts`.
- Core summary compaction lives in `packages/coding-agent/src/core/compaction/compaction.ts`.
- Context-compaction work adds `packages/coding-agent/src/core/compaction/context-compaction.ts`, `ContextCompactionEntry`, `contextCompact()`, context-compaction events, RPC dispatch, docs, and tests.
- Session persistence is JSONL through `packages/coding-agent/src/core/session-manager.ts`.
- `buildSessionContext()` emits the latest summary `compaction` as a `compactionSummary` message, then retained raw entries.
- Branch summarization lives in `packages/coding-agent/src/core/compaction/branch-summarization.ts`.

**Review-found gaps addressed across iterations:**
- Deleted content must not leak into future `/compact`, repeated `/context-compact`, or branch-summary prompts.
- Excluded-from-context content must not enter planner prompts.
- Failed bash outputs must be protected.
- Context-compaction stats must not trust stale pre-boundary assistant usage.
- Active `/compact` summaries must be included as protected planner context.
- Image block deletion stats must account for image-sized token cost.
- `compactionSummary` can be task-bearing context after split-turn `/compact`.

### 2.2 The Problem

- **User Impact:** Summary compaction can paraphrase exact file paths, line numbers, errors, and constraints.
- **Technical Impact:** Atomic needs a deletion-only compaction path with locally enforceable invariants.
- **Privacy Impact:** `!!` bash output and `excludeFromContext` custom messages must remain out of LLM planner prompts.
- **Debugging Impact:** Failed shell outputs often contain unresolved error text and must not be deleted.
- **Context-Consistency Impact:** Planner prompts, branch summaries, stats, and rebuilt context must all see the same filtered context.
- **API Impact:** RPC clients need typed command and event support.

### 2.3 Review Round 1 Findings Addressed

- Apply context deletions before summary compaction.
- Filter deleted blocks out of planner entry text.
- Count removed blocks in context-compaction stats.

### 2.4 Review Round 2 Findings Addressed

- Treat `context_compaction` as a usage boundary.
- Add `RpcClient.contextCompact()`.

### 2.5 Review Round 3 Findings Addressed

- Respect messages excluded from LLM context.

### 2.6 Review Round 4 Findings Addressed

- Protect failed bash outputs.
- Stop trusting pre-boundary usage for context-compaction stats.
- Type RPC events as session events.

### 2.7 Review Round 5 Findings Addressed

- Include existing `/compact` summaries in the context view.

### 2.8 Review Round 6 Findings Addressed

- **[P2] Count deleted image blocks with image-sized token estimates:** content-block estimates must use image-sized accounting for `{ type: "image" }`, even if prompt text renders as `[image]`.
- **[P2] Filter context deletions before branch summaries:** branch summarization must receive deletion-filtered entries, or deleted content can be reintroduced in `branch_summary`.
- **[P2] Accept compaction summaries as task-bearing context:** validation must treat protected `compactionSummary` as sufficient task-bearing context when raw user messages have been summarized away.

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] Add `/context-compact` to builtin command discovery/autocomplete.
- [ ] Add exact no-args interactive `/context-compact` handling.
- [ ] Reject `/context-compact <extra text>` without exposing custom instructions.
- [ ] Add RPC `context_compact` and typed `RpcClient.contextCompact()`.
- [ ] Type RPC event listeners/collectors as `AgentSessionEvent` / `RpcEvent`.
- [ ] Use a fixed deletion-only prompt matching issue #1274 and screenshot rules.
- [ ] Validate model deletion plans locally.
- [ ] Preserve user instructions, current paths/line numbers, unresolved errors, pending plan, recent operations, session metadata, failed bash outputs, and active `/compact` summaries.
- [ ] Preserve tool-call/tool-result dependency validity.
- [ ] Preserve `excludeFromContext` semantics.
- [ ] Persist a `context_compaction` entry that rebuilds active context correctly.
- [ ] Ensure `/compact`, auto-compaction, repeated `/context-compact`, and branch summarization all use deletion-filtered context.
- [ ] Compute stats from filtered local estimates, including image-sized block estimates.
- [ ] Treat `compactionSummary` as task-bearing context.
- [ ] Create a pre-compaction backup/snapshot.
- [ ] Update tests, docs, and changelog.

### 3.2 Non-Goals (Out of Scope)

- [ ] Do not change `/compact [prompt]` behavior.
- [ ] Do not make auto-compaction use verbatim compaction.
- [ ] Do not add user-facing prompt configuration for `/context-compact`.
- [ ] Do not allow the model to rewrite compacted transcripts.
- [ ] Do not include excluded/display-only messages in planner prompts.
- [ ] Do not allow deletion of failed bash output or active `/compact` summary entries.
- [ ] Do not report stale assistant usage as context-compaction stats.
- [ ] Do not add a restore command in this iteration.
- [ ] Do not create a PR in this design stage.

## 4. Proposed Solution (High-Level Design)

Add a distinct context-compaction path alongside summary compaction:

1. Register `/context-compact`.
2. Parse it as an exact no-args command.
3. Build a unified context-compaction view of the active branch with:
   - logical deletions applied;
   - LLM-context exclusions applied;
   - active `/compact` summary included as protected context;
   - failed-bash protection applied;
   - image block token estimates preserved.
4. Ask the selected model, with a fixed prompt, for deletion targets only.
5. Validate the deletion plan.
6. Compute stats from the same eligible filtered transcript.
7. Write a backup snapshot.
8. Append a `context_compaction` entry.
9. Rebuild active LLM context.
10. Treat `context_compaction` as a usage boundary.
11. Apply the same filtering before future summary compaction and branch summarization.
12. Expose command/events through typed RPC APIs.

### 4.1 System Architecture Diagram

```mermaid
flowchart TB
    User(("User"))
    Model{{"Selected Model<br/>no tools"}}
    RpcClient["RpcClient<br/>contextCompact() + AgentSessionEvent"]

    subgraph Atomic["Atomic process"]
        Slash{{"/context-compact<br/>no args"}}
        Interactive["InteractiveMode"]
        RPC["RPC Mode"]
        Session["AgentSession.contextCompact()"]
        Eligibility["respect_llm_context_exclusion"]
        Summary["include_summary_compaction_context"]
        FailedBash["protect_failed_bash_outputs"]
        ImageStats["estimate_image_block_tokens"]
        View["build_context_compaction_view"]
        Planner["plan_context_deletions"]
        Validator{{"validate_context_deletion_plan"}}
        Stats["estimate
