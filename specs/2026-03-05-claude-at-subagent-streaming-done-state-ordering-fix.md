# Atomic CLI Claude `@` Sub-Agent Done-State Ordering Technical Design Document / RFC

| Document Metadata      | Details                                      |
| ---------------------- | -------------------------------------------- |
| Author(s)              | lavaman131                                   |
| Status                 | Draft (WIP)                                  |
| Team / Owner           | Atomic CLI / Workflow Runtime                |
| Created / Last Updated | Phase-tracked (updated as decisions resolve) |

## 1. Executive Summary

Atomic CLI currently shows a user-visible ordering gap during Claude SDK `@` sub-agent runs: additional streamed output can appear before the parallel agent tree row visibly flips to `Done`. Research shows this is primarily caused by split update lanes and staged state synchronization rather than a single isolated bug. Specifically, lifecycle completion updates and stream-part updates traverse different bus paths, while the tree done-state requires a follow-up `useEffect` bake into message parts before rendering. (Ref: `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:22`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:26`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:91`)

This RFC proposes an ordering contract that prioritizes lifecycle terminal visibility for sub-agents and introduces a deterministic synchronization path between `stream.agent.complete` and tree rendering. The plan adds instrumentation, a strict done-before-post-complete-text projection path, and reducer unification follow-up if needed.

Impact: improved UX predictability, fewer perceived race regressions in Claude `@` flows, and stronger automated verification of event-ordering invariants.

## 2. Context and Motivation

### 2.1 Current State

- **Architecture:** Claude `@` mention dispatch triggers fire-and-forget command fan-out; stream startup is immediate and asynchronous. (Ref: `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:36`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:45`)
- **Lifecycle lane:** `stream.agent.start/update/complete` is handled via direct typed bus subscriptions that update `parallelAgents` in `chat.tsx`. (Ref: `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:24`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:61`)
- **Content lane:** text/tool stream events go through wildcard subscription -> `BatchDispatcher` -> `StreamPipelineConsumer` -> part reducer callbacks, with frame batching. (Ref: `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:25`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:53`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:54`)
- **Done-state rendering:** the tree does not render done directly from `stream.agent.complete`; it appears after `parallelAgents` is baked into message parts by a follow-up effect. (Ref: `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:62`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:65`)

### 2.2 The Problem

- **User Impact:** during active streaming, users can observe new output before a completed sub-agent visually shows `Done`, creating perceived inconsistency in chronological flow.
- **Behavioral Impact:** ordering semantics are not explicit as a product contract; current behavior is architecture-driven eventual consistency.
- **Technical Debt:** lifecycle and content updates are split across different synchronization boundaries, making ordering guarantees hard to test and reason about. (Ref: `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:57`, `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md:97`)

## 3. Goals and Non-Goals

### 3.1 Functional Goals

- [ ] Define and enforce a deterministic ordering contract between `stream.agent.complete` and visible tree `Done` state.
- [ ] Preserve existing streaming responsiveness while minimizing done-state lag.
- [ ] Support both single-mention and multi-mention `@` invocation flows under the same ordering guarantees.
- [ ] Add instrumentation and tests that detect regressions in ordering behavior.
- [ ] Resolve Claude ordering behavior without regressing existing OpenCode/Copilot behavior.

### 3.2 Non-Goals (Out of Scope)

- [ ] We will NOT redesign the entire event bus architecture in this iteration.
- [ ] We will NOT remove `BatchDispatcher` or wildcard consumers globally.
- [ ] We will NOT change Claude SDK upstream hook ordering behavior.
- [ ] We will NOT introduce a full transcript storage format migration.

## 4. Proposed Solution (High-Level Design)

### 4.1 System Architecture Diagram

```mermaid
flowchart LR
    subgraph Input[Command + Adapter]
        A1[@ mention parse + dispatch]
        A2[sendSilentMessage/startAssistantStream]
        A3[Claude adapter emits stream events]
    end

    subgraph Eventing[Atomic Eventing]
        B1[Typed Bus Handlers]
        B2[Wildcard Bus Handlers]
        B3[BatchDispatcher]
        B4[StreamPipelineConsumer]
    end

    subgraph UIState[Chat/UI State]
        C1[parallelAgents live state]
        C2[Done-state Sync Bridge]
        C3[Message parts reducer]
        C4[ParallelAgentsTree render]
    end

    A1 --> A2 --> A3
    A3 --> B1
    A3 --> B2
    B2 --> B3 --> B4 --> C3
    B1 --> C1 --> C2 --> C3 --> C4
    C2 -. ordering contract .-> C4
```

### 4.2 Architectural Pattern

- **Pattern:** Event-driven UI reconciliation with lifecycle-priority synchronization.
- **Principle:** terminal lifecycle visibility (`completed`) must be projected to renderable tree state through a deterministic path, not only eventual effect propagation.

### 4.3 Key Components

| Component | Responsibility | Technology Stack | Justification |
| --- | --- | --- | --- |
| Done-State Sync Bridge (new) | Applies immediate, idempotent message-part sync on `stream.agent.complete` | TypeScript in `src/ui/chat.tsx` + part reducer integration | Removes extra render hop as sole source of done-state visibility lag. |
| Ordering Contract Guard (new) | Validates per-agent ordering assertions in runtime and tests | TypeScript utilities + test helpers | Makes ordering behavior explicit, measurable, and regression-resistant. |
| Lifecycle Event Mapper (enhanced) | Ensures terminal lifecycle signal is represented in reducer path | `src/events/consumers/stream-pipeline-consumer.ts` and related types | Reduces divergence between lifecycle lane and content lane. |
| Instrumentation Layer (new/extended) | Emits timestamped markers for completion, bake, and render visibility | Existing telemetry/logging hooks in UI + event consumers | Enables empirical verification across single/multi-mention scenarios. |

## 5. Detailed Design

### 5.1 API Interfaces

This RFC introduces internal runtime contracts (no external HTTP API changes).

```ts
export interface AgentOrderingEvent {
  sessionId: string;
  agentId: string;
  messageId: string;
  type:
    | "agent_complete_received"
    | "agent_done_projected"
    | "agent_done_rendered"
    | "post_complete_delta_rendered";
  sequence: number;
  timestampMs: number;
  source: "typed-bus" | "wildcard-batch" | "ui-effect" | "sync-bridge";
}

export interface DoneStateProjection {
  sessionId: string;
  messageId: string;
  agentId: string;
  fromStatus: "running" | "pending";
  toStatus: "completed";
  projectionMode: "effect" | "sync-bridge";
  idempotencyKey: string;
}

export interface OrderingContractConfig {
  enableOrderingDiagnostics: boolean;
}
```

### 5.2 Data Model / Schema

#### Runtime State Additions

```ts
interface AgentOrderingState {
  lastCompletionSequenceByAgent: Map<string, number>;
  doneProjectedByAgent: Map<string, boolean>;
  firstPostCompleteDeltaSequenceByAgent: Map<string, number>;
  projectionSourceByAgent: Map<string, "effect" | "sync-bridge">;
}
```

#### Part/Event Extensions

- Add explicit `parallel-agents-terminal` part event or equivalent reducer action carrying terminal lifecycle transitions.
- Preserve existing `parallel-agents` event merge path for compatibility; treat sync-bridge writes as idempotent updates.
- Extend stream-pipeline event policy to classify lifecycle terminal events as `render-affecting` rather than `state-only` for ordering-sensitive UI paths.

### 5.3 Algorithms and State Management

- **State machine:** `started -> running -> completed(received) -> completed(projected) -> completed(rendered)`.
- **Done-state projection algorithm:**
  1. On `stream.agent.complete`, update live `parallelAgents` as today.
  2. Immediately emit/update corresponding message-part terminal state.
  3. Keep existing `useEffect` bake path active but idempotent.
  4. Mark `doneProjectedByAgent=true` and capture projection sequence.
- **Ordering gate (strict mode, mandatory):**
  - Defer rendering of agent-scoped post-complete text deltas until done projection exists for that agent.
  - Always record diagnostics for measured completion-to-render latency and any violated invariants.
- **Idempotency rule:**
  - terminal projection updates are no-op when target agent is already `completed` in message-part state.

### 5.4 Planned File-Level Changes

| File / Area | Planned Change |
| --- | --- |
| `src/ui/chat.tsx` | Add strict terminal projection on `stream.agent.complete`; keep effect bake as idempotent compatibility path; add ordering diagnostics hooks. |
| `src/ui/parts/stream-pipeline.ts` | Add reducer support for terminal projection event/action and idempotency behavior. |
| `src/events/consumers/stream-pipeline-consumer.ts` | Map lifecycle terminal events into reducer-facing events where applicable; annotate policy classification. |
| `src/events/bus-events.ts` | Extend event typings/metadata for ordering diagnostics sequence and source labels. |
| `src/ui/components/parallel-agents-tree.tsx` | Add optional render callback marker for `agent_done_rendered` diagnostics. |
| `src/ui/chat.session-idle-flush.test.ts` and new ordering tests | Add invariant tests for done projection and post-complete delta ordering under batch conditions. |

## 6. Alternatives Considered

| Option | Pros | Cons | Reason for Rejection / Selection |
| --- | --- | --- | --- |
| Option A: Keep current behavior | Zero change risk | Ordering mismatch remains user-visible; contract stays implicit | Rejected: does not satisfy the problem statement. |
| Option B: Immediate sync-bridge projection (Selected initial path) | Surgical change; directly targets symptom; keeps architecture mostly intact | Requires careful idempotency to avoid duplicate state writes | **Selected:** best risk-to-impact ratio and aligns with strict ordering requirement. |
| Option C: Full single-lane reducer unification | Strongest determinism and conceptual clarity | Broad refactor with larger regression surface | Deferred: considered follow-up once instrumentation confirms residual issues. |
| Option D: Batch policy only (priority flush) | Small eventing-layer change | Partial mitigation; effect-hop lag can still occur | Rejected as standalone fix; can be additive if needed after Phase 2. |

## 7. Cross-Cutting Concerns

### 7.1 Security and Privacy

- No new external interfaces or auth surfaces are introduced.
- Ordering diagnostics should avoid logging sensitive prompt/tool payload content; log event identifiers and timing only.
- Follow existing telemetry redaction rules for session identifiers.

### 7.2 Observability Strategy

- Add counters and timers:
  - `agent_done_projection_total{mode=effect|sync_bridge}`
  - `agent_done_projection_latency_ms`
  - `agent_post_complete_delta_before_done_total`
  - `agent_ordering_contract_violation_total{scenario=single|multi}`
- Emit structured debug events for ordered traces in test and debug builds.
- Add per-scenario dashboards for single-mention and multi-mention runs.

### 7.3 Scalability and Capacity Planning

- Additional per-agent ordering maps are bounded by active session scope and cleaned on session finalize.
- Sync-bridge projection is O(1) per lifecycle terminal event and should not materially affect render throughput.
- Strict ordering path is always on; latency trade-offs are managed through implementation optimization, not behavior fallback.

## 8. Migration, Rollout, and Testing

### 8.1 Deployment Strategy

- [ ] Phase 1: Add instrumentation and ordering diagnostics with no behavior change.
- [ ] Phase 2: Enable strict done projection path in default runtime behavior; keep legacy effect bake path idempotent.
- [ ] Phase 3: Enable ordering contract checks in CI and canary sessions; monitor violations.
- [ ] Phase 4: Decide whether reducer unification is still required based on observed outcomes.

### 8.2 Data Migration Plan

- No durable database migration required.
- In-memory message/session state remains backward compatible.
- Existing transcript rendering continues to function; new projection events are additive.

### 8.3 Test Plan

- **Unit Tests:**
  - Done-state sync-bridge idempotency and no-op behavior on repeated terminal events.
  - Ordering state bookkeeping for sequence/timestamp capture.
  - Event policy classification for lifecycle terminal events.
- **Integration Tests:**
  - `@` single-mention flow: assert `agent_done_rendered` occurs before any agent-scoped post-complete delta render in strict mode.
  - `@` multi-mention fan-out flow: verify per-agent isolation of ordering assertions.
  - Batch-dispatch scenario: ensure `stream.session.idle` flush behavior still finalizes consistent state.
- **End-to-End Tests:**
  - Long-running Claude sub-agent sessions with mixed text/tool output.
  - Regression harness reproducing known direct-vs-batched timing windows.

## 9. Open Questions / Unresolved Issues

- [x] **Ordering Contract Strictness (Resolved):** Product behavior requires strict per-agent ordering; tree `Done` must render before any post-complete agent text. No fallback flag should be introduced.
- [x] **Scope of Guarantee (Resolved):** The ordering contract is required for both single-mention and multi-mention `@` submits from day one.
- [x] **Cross-Provider Policy (Resolved):** This RFC is Claude-focused because OpenCode/Copilot behavior is already acceptable; no mandatory parity migration is required in this change.

## Research References

- `research/docs/2026-03-05-claude-at-subagent-streaming-done-state-ordering.md`
- `research/docs/2026-02-15-subagent-event-flow-diagram.md`
- `research/docs/2026-02-15-sub-agent-tree-status-lifecycle-sdk-parity.md`
- `research/docs/2026-02-23-258-background-agents-sdk-event-pipeline.md`
- `research/docs/2026-02-23-gh-issue-258-background-agents-ui.md`
- `research/docs/2026-02-28-workflow-issues-research.md`
- `research/docs/2026-02-28-workflow-tui-rendering-unification-refactor.md`
- `research/docs/2026-02-26-streaming-architecture-event-bus-migration.md`
