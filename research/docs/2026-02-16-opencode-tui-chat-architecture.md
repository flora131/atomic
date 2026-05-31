# OpenCode TUI Chat Architecture

**Date**: 2026-02-16  
**Source**: `docs/opencode/` (local copy of anomalyco/opencode)  
**Analysis Focus**: Message rendering, part model, content ordering, sub-agent lifecycle, HITL placement, event processing

---

## Overview

OpenCode's TUI (Terminal User Interface) uses a reactive event-driven architecture where the backend streams message parts chronologically via Server-Sent Events, the frontend stores them in a sorted array keyed by message ID, and SolidJS components render them in order. Parts are identified with chronologically-ordered IDs, ensuring that tool outputs, sub-agent trees, and interactive prompts appear inline at the correct position within streamed content.

---

## Entry Points

### Backend (Core Logic)

- `packages/opencode/src/session/processor.ts:45` - `SessionProcessor.process()` - Main stream processing loop
- `packages/opencode/src/session/index.ts:646` - `Session.updatePart()` - Upserts part to database and emits event
- `packages/opencode/src/session/message-v2.ts:771` - `MessageV2.parts()` - Retrieves parts ordered by ID

### Frontend (UI Components)

- `packages/ui/src/components/session-turn.tsx:186` - `SessionTurn` component - Main turn renderer
- `packages/ui/src/components/message-part.tsx:276` - `Message` component - Routes message role to display
- `packages/ui/src/components/message-part.tsx:484` - `Part` component - Dynamic part renderer
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:107` - Event listener - Processes all SSE events

### Data Layer

- `packages/ui/src/context/data.tsx:14` - Data store type definition
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:35` - Store initialization with reactive subscriptions

---

## 1. Message & Part Data Model

### SDK Type Definitions

Location: `packages/sdk/js/src/v2/gen/types.gen.ts`

#### Messages

Messages are discriminated unions by role:

- **UserMessage** (lines 118-141): Contains `id`, `sessionID`, `role: "user"`, `time.created`, optional `format`, `summary`, `agent`, `model`
- **AssistantMessage** (lines 204-244): Contains `id`, `sessionID`, `role: "assistant"`, `time.created/completed`, optional `error`, `parentID`, `modelID`, `providerID`, `tokens`, `cost`

#### Parts

Parts are discriminated unions by type (lines 510-522):

- **TextPart** (263-278): `id`, `messageID`, `text`, `synthetic?`, `time.start/end`
- **ReasoningPart** (295-308): `id`, `messageID`, `text`, `time.start/end`
- **ToolPart** (419-430): `id`, `messageID`, `callID`, `tool`, `state` (discriminated by status)
- **FilePart** (351-360): `id`, `messageID`, `mime`, `url`, `filename?`, `source?`
- **AgentPart** (477-488): `id`, `messageID`, `name`, `source?` (text range)
- **StepStartPart** (432-438): `id`, `messageID`, `snapshot?`
- **StepFinishPart** (440-458): `id`, `messageID`, `reason`, `snapshot?`, `cost`, `tokens`
- **PatchPart** (468-475): `id`, `messageID`, `hash`, `files[]`
- **SubtaskPart** (280-293): `id`, `messageID`, `prompt`, `description`, `agent`
- **RetryPart** (490-500): `id`, `messageID`, `attempt`, `error`, `time.created`
- **CompactionPart** (502-508): `id`, `messageID`, `auto`

#### Tool State

Tool state is a discriminated union by status (lines 362-417):

- **ToolStatePending**: `status: "pending"`, `input`, `raw`
- **ToolStateRunning**: `status: "running"`, `input`, `title?`, `metadata?`, `time.start`
- **ToolStateCompleted**: `status: "completed"`, `input`, `output`, `title`, `metadata`, `time.start/end`, `attachments?`
- **ToolStateError**: `status: "error"`, `input`, `error`, `metadata?`, `time.start/end`

---

## 2. ID Generation & Chronological Ordering

### ID Structure

Location: `packages/opencode/src/id/id.ts:55-74`

IDs are generated using `Identifier.ascending("part")`:

- **Format**: `prt_<12-hex-chars><14-random-base62>` (e.g., `prt_18f4a2b3c5d6AbCdEfGhIjKlMn`)
- **First 6 bytes encode**: `(timestamp_ms * 0x1000 + counter)` in big-endian
- **Counter increments** within same millisecond to ensure uniqueness
- **Result**: Lexicographically sortable IDs that maintain chronological order

### Part Retrieval

Location: `packages/opencode/src/session/message-v2.ts:771`

```typescript
db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all()
```

Parts are sorted by ID, which implicitly sorts them chronologically due to the ID generation scheme.

---

## 3. Event Processing Pipeline

### Stream → Part → Event → Store → UI

#### Backend: Stream Processing

Location: `packages/opencode/src/session/processor.ts:45-349`

The processor loops through AI SDK stream events:

##### 1. Text Content (lines 287-337)

- `text-start`: Creates new `TextPart` with ascending ID, calls `Session.updatePart()`
- `text-delta`: Appends to `currentText.text`, calls `Session.updatePartDelta()` (emits delta event)
- `text-end`: Finalizes text, sets end timestamp, calls `Session.updatePart()`

##### 2. Tool Calls (lines 111-229)

- `tool-input-start`: Creates `ToolPart` with `status: "pending"`, ascending ID
- `tool-call`: Updates to `status: "running"`, stores in `toolcalls` map
- `tool-result`: Updates to `status: "completed"` with output/metadata/attachments
- `tool-error`: Updates to `status: "error"` with error message

##### 3. Reasoning (lines 62-109)

- `reasoning-start`: Creates `ReasoningPart`, stores in `reasoningMap`
- `reasoning-delta`: Appends to reasoning text via delta event
- `reasoning-end`: Finalizes with end timestamp

##### 4. Step Boundaries (lines 233-285)

- `start-step`: Creates `StepStartPart` with snapshot
- `finish-step`: Creates `StepFinishPart` with tokens/cost/snapshot

#### Database Update

Location: `packages/opencode/src/session/index.ts:646-667`

```typescript
export const updatePart = fn(UpdatePartInput, async (part) => {
  const { id, messageID, sessionID, ...data } = part
  const time = Date.now()
  Database.use((db) => {
    db.insert(PartTable)
      .values({ id, message_id: messageID, session_id: sessionID, time_created: time, data })
      .onConflictDoUpdate({ target: PartTable.id, set: { data } })
      .run()
    Database.effect(() =>
      Bus.publish(MessageV2.Event.PartUpdated, { part }),
    )
  })
  return part
})
```

Upserts part to database and emits `message.part.updated` event via bus.

#### Frontend: Event Handling

Location: `packages/opencode/src/cli/cmd/tui/context/sync.tsx:281-318`

Events are processed in the SDK listener:

```typescript
case "message.part.updated": {
  const parts = store.part[event.properties.part.messageID]
  if (!parts) {
    setStore("part", event.properties.part.messageID, [event.properties.part])
    break
  }
  const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
  if (result.found) {
    setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
    break
  }
  setStore(
    "part",
    event.properties.part.messageID,
    produce((draft) => {
      draft.splice(result.index, 0, event.properties.part)
    }),
  )
  break
}
```

Uses binary search to find insertion point (based on lexicographic ID ordering), then either updates existing part or inserts at correct position. The `Binary.search` returns `{ found: boolean, index: number }` where `index` is the position to insert if not found.

Delta events update incrementally (lines 302-318):

```typescript
case "message.part.delta": {
  const parts = store.part[event.properties.messageID]
  if (!parts) break
  const result = Binary.search(parts, event.properties.partID, (p) => p.id)
  if (!result.found) break
  setStore(
    "part",
    event.properties.messageID,
    produce((draft) => {
      const part = draft[result.index]
      const field = event.properties.field as keyof typeof part
      const existing = part[field] as string | undefined
      ;(part[field] as string) = (existing ?? "") + event.properties.delta
    }),
  )
  break
}
```

---

## 4. UI Rendering Architecture

### SessionTurn Component

Location: `packages/ui/src/components/session-turn.tsx`

#### Message Hierarchy (lines 186-289)

- Finds user message in session (lines 216-238)
- Collects all assistant messages following the user message until next user message (lines 272-292)
- Each assistant message maintains its own parts array

#### Parts Retrieval (lines 147-181)

```typescript
const msgParts = createMemo(() => list(data.store.part?.[props.message.id], emptyParts))

const filteredParts = createMemo(() => {
  let parts = msgParts()
  
  if (props.hideReasoning) {
    parts = parts.filter((part) => part?.type !== "reasoning")
  }
  
  if (props.hideResponsePart) {
    const responsePartId = props.responsePartId
    if (responsePartId && responsePartId === lastTextPart()?.id) {
      parts = parts.filter((part) => part?.id !== responsePartId)
    }
  }
  
  const hidden = props.hidden?.() ?? []
  if (hidden.length === 0) return parts
  
  const id = props.message.id
  return parts.filter((part) => {
    if (part?.type !== "tool") return true
    const tool = part as ToolPart
    return !hidden.some((h) => h.messageID === id && h.callID === tool.callID)
  })
})
```

Parts are filtered to hide:
- Reasoning during non-working state (line 162)
- Last text part when showing as summary response (lines 167-169)
- Tool parts awaiting permission/question (lines 172-180)

#### Rendering (lines 744-754)

```typescript
<For each={assistantMessages()}>
  {(assistantMessage) => (
    <AssistantMessageItem
      message={assistantMessage}
      responsePartId={responsePartId()}
      hideResponsePart={hideResponsePart()}
      hideReasoning={!working()}
      hidden={hidden}
    />
  )}
</For>
```

### Message Component

Location: `packages/ui/src/components/message-part.tsx:276-302`

Routes messages by role:

```typescript
export function Message(props: MessageProps) {
  return (
    <Switch>
      <Match when={props.message.role === "user" && props.message}>
        {(userMessage) => <UserMessageDisplay message={userMessage() as UserMessage} parts={props.parts} />}
      </Match>
      <Match when={props.message.role === "assistant" && props.message}>
        {(assistantMessage) => (
          <AssistantMessageDisplay message={assistantMessage() as AssistantMessage} parts={props.parts} />
        )}
      </Match>
    </Switch>
  )
}
```

#### AssistantMessageDisplay (lines 291-302)

```typescript
export function AssistantMessageDisplay(props: { message: AssistantMessage; parts: PartType[] }) {
  const emptyParts: PartType[] = []
  const filteredParts = createMemo(
    () =>
      props.parts.filter((x) => {
        return x.type !== "tool" || (x as ToolPart).tool !== "todoread"
      }),
    emptyParts,
    { equals: same },
  )
  return <For each={filteredParts()}>{(part) => <Part part={part} message={props.message} />}</For>
}
```

Iterates through parts array in order, rendering each via the `Part` component.

### Part Component

Location: `packages/ui/src/components/message-part.tsx:484-497`

Dynamic component dispatcher:

```typescript
export function Part(props: MessagePartProps) {
  const component = createMemo(() => PART_MAPPING[props.part.type])
  return (
    <Show when={component()}>
      <Dynamic
        component={component()}
        part={props.part}
        message={props.message}
        hideDetails={props.hideDetails}
        defaultOpen={props.defaultOpen}
      />
    </Show>
  )
}
```

Uses `PART_MAPPING` registry (line 106) to route part types to renderers:
- `PART_MAPPING["text"]` → `TextPartDisplay` (lines 669-710)
- `PART_MAPPING["reasoning"]` → `ReasoningPartDisplay` (lines 712-724)
- `PART_MAPPING["tool"]` → `ToolPartDisplay` (lines 535-667)

---

## 5. Content Ordering & Stream Placement

### Chronological Positioning

Parts appear at the correct chronological position because:

1. **ID Generation** (`packages/opencode/src/id/id.ts:55-74`): Each part gets an ascending ID encoding `timestamp * 0x1000 + counter`
2. **Database Ordering** (`packages/opencode/src/session/message-v2.ts:771`): Query sorts by ID: `.orderBy(PartTable.id)`
3. **Frontend Insertion** (`packages/opencode/src/cli/cmd/tui/context/sync.tsx:292-298`): Binary search maintains sorted order in store
4. **Rendering** (`packages/ui/src/components/message-part.tsx:301`): `<For each={filteredParts()}>` iterates in array order

### Example Flow: Tool Call Inline with Text

When the backend processes a stream:

**Timestamp T1**: Text arrives
```typescript
// processor.ts:287-299
case "text-start":
  currentText = {
    id: Identifier.ascending("part"), // prt_18f4a2b3c5d6...
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "text",
    text: "",
    time: { start: Date.now() },
  }
  await Session.updatePart(currentText)
```

**Timestamp T2**: Tool call arrives (while text still streaming)
```typescript
// processor.ts:111-126
case "tool-input-start":
  const part = await Session.updatePart({
    id: Identifier.ascending("part"), // prt_18f4a2b3c5d7... (later ID)
    messageID: input.assistantMessage.id,
    sessionID: input.assistantMessage.sessionID,
    type: "tool",
    tool: value.toolName,
    callID: value.id,
    state: { status: "pending", input: {}, raw: "" },
  })
```

**Timestamp T3**: Text ends
```typescript
// processor.ts:316-335
case "text-end":
  currentText.text = currentText.text.trimEnd()
  currentText.time = { start: Date.now(), end: Date.now() }
  await Session.updatePart(currentText) // Updates existing prt_18f4a2b3c5d6...
```

**Timestamp T4**: Tool result arrives
```typescript
// processor.ts:180-201
case "tool-result":
  await Session.updatePart({
    ...match,
    state: {
      status: "completed",
      input: value.input ?? match.state.input,
      output: value.output.output,
      title: value.output.title,
      time: { start: match.state.time.start, end: Date.now() },
    },
  }) // Updates existing prt_18f4a2b3c5d7...
```

**Final Order in Store**:
```
parts[messageID] = [
  { id: "prt_18f4a2b3c5d6...", type: "text", text: "Let me check that..." },
  { id: "prt_18f4a2b3c5d7...", type: "tool", tool: "read", state: { status: "completed", output: "..." } },
]
```

The tool part appears **after** the text part because its ID was created later, even though both were streaming concurrently. The UI renders them in this order via `<For each={parts}>`.

---

## 6. Sub-Agent Lifecycle Rendering

### Task Tool Special Handling

Location: `packages/ui/src/components/message-part.tsx:874-1077`

The `task` tool renderer displays sub-agent state:

#### Sub-Session Tracking (lines 879-901)

```typescript
const childSessionId = () => props.metadata.sessionId as string | undefined

const href = createMemo(() => {
  const sessionId = childSessionId()
  if (!sessionId) return
  const direct = data.sessionHref?.(sessionId)
  if (direct) return direct
  // Generate relative URL if needed
})

createEffect(() => {
  const sessionId = childSessionId()
  if (!sessionId) return
  const sync = data.syncSession
  if (!sync) return
  Promise.resolve(sync(sessionId)).catch(() => undefined)
})
```

When a task tool completes with `metadata.sessionId`, the UI syncs that session's data.

#### Child Tool Parts Display (lines 948-1071)

```typescript
const childToolParts = createMemo(() => {
  const sessionId = childSessionId()
  if (!sessionId) return []
  return getSessionToolParts(data.store, sessionId)
})

// ...inside render:
<BasicTool icon="task" defaultOpen={true} trigger={trigger()}>
  <div data-component="tool-output" data-scrollable>
    <div ref={autoScroll.contentRef} data-component="task-tools">
      <For each={childToolParts()}>
        {(item) => {
          const info = createMemo(() => getToolInfo(item.tool, item.state.input))
          const subtitle = createMemo(() => {
            if (info().subtitle) return info().subtitle
            if (item.state.status === "completed" || item.state.status === "running") {
              return item.state.title
            }
          })
          return (
            <div data-slot="task-tool-item">
              <Icon name={info().icon} size="small" />
              <span data-slot="task-tool-title">{info().title}</span>
              <Show when={subtitle()}>
                <span data-slot="task-tool-subtitle">{subtitle()}</span>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  </div>
</BasicTool>
```

#### getSessionToolParts Helper (lines 160-174)

```typescript
export function getSessionToolParts(store: ReturnType<typeof useData>["store"], sessionId: string): ToolPart[] {
  const messages = store.message[sessionId]?.filter((m) => m.role === "assistant")
  if (!messages) return []

  const parts: ToolPart[] = []
  for (const m of messages) {
    const msgParts = store.part[m.id]
    if (msgParts) {
      for (const p of msgParts) {
        if (p && p.type === "tool") parts.push(p as ToolPart)
      }
    }
  }
  return parts
}
```

Collects all tool parts from the child session, displaying them as a flat list of actions taken by the sub-agent.

#### Sub-Agent State Display

The task tool shows:
- **Link to child session** (lines 932-937): Clickable subtitle if `sessionHref` is available
- **Tool icon + title** for each action (lines 1060-1061)
- **Subtitle** showing tool-specific details (lines 1062-1064)
- **Status** reflected via tool state (pending/running/completed/error)

---

## 7. Ask/HITL Component Placement

### Permission & Question Tracking

#### Store Structure

Location: `packages/ui/src/context/data.tsx:25-30`

```typescript
permission?: {
  [sessionID: string]: PermissionRequest[]
}
question?: {
  [sessionID: string]: QuestionRequest[]
}
```

#### Event Handling

Location: `packages/opencode/src/cli/cmd/tui/context/sync.tsx:166-186`

```typescript
case "question.asked": {
  const request = event.properties
  const requests = store.question[request.sessionID]
  if (!requests) {
    setStore("question", request.sessionID, [request])
    break
  }
  const match = Binary.search(requests, request.id, (r) => r.id)
  if (match.found) {
    setStore("question", request.sessionID, match.index, reconcile(request))
    break
  }
  setStore(
    "question",
    request.sessionID,
    produce((draft) => {
      draft.splice(match.index, 0, request)
    }),
  )
  break
}
```

Questions are stored per-session and removed when replied/rejected (lines 150-163).

### Question Association with Tool Parts

#### Request Structure

Location: `packages/sdk/js/src/v2/gen/types.gen.ts:643-654`

```typescript
export type QuestionRequest = {
  id: string
  sessionID: string
  questions: Array<QuestionInfo>
  tool?: {
    messageID: string
    callID: string
  }
}
```

The optional `tool` field links the question to a specific tool part.

### Tool Part Rendering with Question

Location: `packages/ui/src/components/message-part.tsx:535-667`

#### Question Detection (lines 547-575)

```typescript
const questionRequest = createMemo(() => {
  const next = data.store.question?.[props.message.sessionID]?.[0]
  if (!next || !next.tool) return undefined
  if (next.tool!.callID !== part.callID) return undefined
  return next
})

const [showQuestion, setShowQuestion] = createSignal(false)

createEffect(() => {
  const question = questionRequest()
  if (question) {
    const timeout = setTimeout(() => setShowQuestion(true), 50)
    onCleanup(() => clearTimeout(timeout))
  } else {
    setShowQuestion(false)
  }
})
```

Checks if the first pending question matches this tool's `callID`.

#### Conditional Rendering (lines 607-665)

```typescript
return (
  <div data-component="tool-part-wrapper" data-permission={showPermission()} data-question={showQuestion()}>
    <Switch>
      <Match when={part.state.status === "error" && part.state.error}>
        {/* Error card */}
      </Match>
      <Match when={true}>
        <Dynamic
          component={render}
          input={input()}
          tool={part.tool}
          metadata={metadata()}
          output={part.state.output}
          status={part.state.status}
          hideDetails={props.hideDetails}
          forceOpen={forceOpen()}
          locked={showPermission() || showQuestion()}
          defaultOpen={props.defaultOpen}
        />
      </Match>
    </Switch>
    <Show when={showPermission() && permission()}>
      {/* Permission prompt */}
    </Show>
    <Show when={showQuestion() && questionRequest()}>{(request) => <QuestionPrompt request={request()} />}</Show>
  </div>
)
```

The question prompt appears **immediately after** the tool component (line 664).

### QuestionPrompt Component

Location: `packages/ui/src/components/message-part.tsx:1384-1624`

#### Structure (lines 1492-1622)

- **Multi-question tabs** (lines 1494-1516): Tab buttons for each question + confirm tab
- **Question content** (lines 1518-1578): Displays current question text, option buttons, custom input form
- **Review panel** (lines 1580-1598): Shows all answers before submission
- **Action buttons** (lines 1600-1621): Dismiss, Next, Submit

#### Answer Collection (lines 1408-1450)

```typescript
function pick(answer: string, custom: boolean = false) {
  const answers = [...store.answers]
  answers[store.tab] = [answer]
  setStore("answers", answers)
  if (custom) {
    const inputs = [...store.custom]
    inputs[store.tab] = answer
    setStore("custom", inputs)
  }
  if (single()) {
    data.replyToQuestion?.({
      requestID: props.request.id,
      answers: [[answer]],
    })
    return
  }
  setStore("tab", store.tab + 1)
}
```

For single questions, submits immediately (lines 1431-1436). For multiple questions, advances to next tab (line 1438).

#### Submission (lines 1408-1414)

```typescript
function submit() {
  const answers = questions().map((_, i) => store.answers[i] ?? [])
  data.replyToQuestion?.({
    requestID: props.request.id,
    answers,
  })
}
```

### Positioning in Stream

Questions appear **inline** at the tool part location because:

1. **Tool Part Created** (T1): `ToolPart` with `status: "running"` is added to parts array at index N
2. **Question Asked** (T2): `QuestionRequest` added to store with `tool.callID` matching the tool part
3. **Rendering**: `ToolPartDisplay` renders at index N, detects matching question, appends `<QuestionPrompt>` immediately after tool UI
4. **After Answer**: Question removed from store, tool part updated to `status: "completed"`, question prompt disappears

The question is **not a separate part**, but a **prompt overlaying the tool part** that created it. This ensures it appears at the correct chronological position (where the tool is in the message stream).

### Answered Questions Display

Location: `packages/ui/src/components/session-turn.tsx:341-367`

#### After Answering (lines 341-362)

```typescript
const answeredQuestionParts = createMemo(() => {
  if (props.stepsExpanded) return emptyQuestionParts
  if (questions().length > 0) return emptyQuestionParts

  const result: { part: ToolPart; message: AssistantMessage }[] = []

  for (const msg of assistantMessages()) {
    const parts = list(data.store.part?.[msg.id], emptyParts)
    for (const part of parts) {
      if (part?.type !== "tool") continue
      const tool = part as ToolPart
      if (tool.tool !== "question") continue
      // @ts-expect-error metadata may not exist on all tool states
      const answers = tool.state?.metadata?.answers
      if (answers && answers.length > 0) {
        result.push({ part: tool, message: msg })
      }
    }
  }

  return result
})
```

When steps are collapsed and no active questions, finds `question` tool parts with `metadata.answers` populated.

#### Rendering (lines 762-767)

```typescript
<Show when={!props.stepsExpanded && answeredQuestionParts().length > 0}>
  <div data-slot="session-turn-answered-question-parts">
    <For each={answeredQuestionParts()}>
      {({ part, message }) => <Part part={part} message={message} />}
    </For>
  </div>
</Show>
```

Displays answered questions in collapsed view so user can see what was asked/answered.

---

## 8. Complete Event Processing Flow

### User Input → Rendered UI

1. **User Submits Message**
   - Frontend calls SDK `session.send()` with text
   - Backend creates `UserMessage` and `AssistantMessage` records
   - Backend starts LLM stream

2. **Stream Processing** (`processor.ts:55-349`)
   - Loop processes stream events
   - For each event type, creates/updates parts with ascending IDs
   - Calls `Session.updatePart()` or `Session.updatePartDelta()`

3. **Database & Event Emission** (`session/index.ts:646-667`)
   - Upserts part to SQLite `PartTable`
   - Publishes `message.part.updated` or `message.part.delta` to event bus

4. **SSE Transport**
   - Backend serializes event to JSON
   - Sends via Server-Sent Events to connected clients

5. **Frontend Event Handling** (`tui/context/sync.tsx:281-318`)
   - SDK receives event, calls listener
   - Switch statement routes to handler
   - Binary search finds position in parts array
   - Updates store via `setStore()` (upsert or append)

6. **Reactive Rendering** (`message-part.tsx:301`, `session-turn.tsx:744`)
   - SolidJS detects store change
   - Memos recompute (e.g., `filteredParts()`)
   - `<For>` component re-renders changed indices
   - Dynamic part components render based on type

7. **User Sees Update**
   - Text streams character-by-character via delta events
   - Tool parts appear when called, update when completed
   - Questions appear inline when asked
   - Sub-agent trees populate as actions execute

---

## Key Architectural Patterns

### 1. ID-Based Chronological Ordering

- **IDs encode time**: `timestamp * 0x1000 + counter` → lexicographic sort = chronological sort
- **No explicit index column**: Database uses `ORDER BY id`, frontend binary search by ID
- **Immutable insertion order**: Once created with ascending ID, part's position is fixed

### 2. Part Type Discrimination

- **Discriminated unions**: TypeScript enforces type safety via `type` field
- **Dynamic dispatch**: `PART_MAPPING` registry maps type → component
- **Tool-specific renderers**: `ToolRegistry.render()` provides custom UI per tool name

### 3. Reactive Store Updates

- **SolidJS stores**: Fine-grained reactivity via `createStore()`
- **Binary search insertion**: Maintains sorted order without full re-sort
- **Reconcile vs Produce**: `reconcile()` for deep equality checks, `produce()` for mutations

### 4. Delta Streaming

- **Incremental updates**: Text/reasoning stream via delta events to reduce latency
- **Local concatenation**: Frontend appends deltas to existing string
- **Throttled rendering**: `createThrottledValue()` limits re-renders to 100ms intervals (line 108)

### 5. Associated Prompts

- **No separate parts**: Permissions/questions are **not parts**, they're session-scoped requests
- **Tool linkage**: `tool.callID` associates prompt with specific tool part
- **Inline overlay**: Prompt renders as child of tool component wrapper
- **Ephemeral**: Removed from store on reply/reject, unlike parts which persist

---

## Data Structures Summary

### Store Structure

Location: `packages/opencode/src/cli/cmd/tui/context/sync.tsx:35-103`

```typescript
{
  message: {
    [sessionID: string]: Message[]  // Sorted by ID
  },
  part: {
    [messageID: string]: Part[]  // Sorted by ID via binary search insertion
  },
  permission: {
    [sessionID: string]: PermissionRequest[]  // First = active
  },
  question: {
    [sessionID: string]: QuestionRequest[]  // First = active
  },
  session_status: {
    [sessionID: string]: SessionStatus  // idle | busy | retry
  }
}
```

### Message/Part Relationship

- Messages are **top-level entities** (user or assistant turns)
- Parts are **children** of messages, keyed by `messageID`
- User messages have parts: text, files, agents
- Assistant messages have parts: text, reasoning, tools, steps, patches

### Part Ordering Guarantees

- Parts within a message are **chronologically ordered** by ID
- IDs are **monotonically increasing** within same process
- Binary search maintains **sorted insertion** in frontend store
- Rendering via `<For>` preserves **array order**

---

## Summary

This architecture ensures that:

1. **Tool outputs** appear inline where tools were called (via chronological IDs)
2. **Sub-agent trees** display actions from child sessions (via task metadata.sessionId)
3. **Interactive prompts** overlay the tool that triggered them (via tool.callID linkage)
4. **Streaming content** flows smoothly with minimal latency (via delta events + throttled rendering)

The key innovation is using **timestamp-encoded IDs** as the single source of ordering truth, eliminating the need for explicit sequence numbers while maintaining perfect chronological ordering across all message parts.
