# OpenCode TUI: Chat Message Rendering Patterns

**Date**: 2026-02-16  
**Source**: `docs/opencode/` directory  
**Purpose**: Document concrete code patterns for rendering chat messages with inline components

---

## 1. Message Part Rendering Patterns

### Pattern 1.1: Message Structure with Parts Array

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:276-302`

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

**Key aspects**:
- Messages contain an array of `parts`
- Parts are rendered in order using SolidJS `<For>` loop
- Assistant messages filter out certain part types (e.g., "todoread" tools)
- Each part is rendered via dynamic component dispatch

### Pattern 1.2: Part Type Dispatch via Registry

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:484-497`

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

**Part type registry**:
```typescript
export const PART_MAPPING: Record<string, PartComponent | undefined> = {}

// Registered part types:
PART_MAPPING["tool"] = function ToolPartDisplay(props) { /* ... */ }
PART_MAPPING["text"] = function TextPartDisplay(props) { /* ... */ }
PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) { /* ... */ }
```

**Key aspects**:
- Uses a global registry mapping part types to components
- Dynamic component rendering with SolidJS `<Dynamic>`
- Each part type has its own rendering logic

### Pattern 1.3: Tool Part Rendering with Sub-Tools

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:535-667`

```typescript
PART_MAPPING["tool"] = function ToolPartDisplay(props) {
  const data = useData()
  const i18n = useI18n()
  const part = props.part as ToolPart

  const permission = createMemo(() => {
    const next = data.store.permission?.[props.message.sessionID]?.[0]
    if (!next || !next.tool) return undefined
    if (next.tool!.callID !== part.callID) return undefined
    return next
  })

  const questionRequest = createMemo(() => {
    const next = data.store.question?.[props.message.sessionID]?.[0]
    if (!next || !next.tool) return undefined
    if (next.tool!.callID !== part.callID) return undefined
    return next
  })

  const [showPermission, setShowPermission] = createSignal(false)
  const [showQuestion, setShowQuestion] = createSignal(false)

  // ... delayed visibility for HITL prompts
  createEffect(() => {
    const perm = permission()
    if (perm) {
      const timeout = setTimeout(() => setShowPermission(true), 50)
      onCleanup(() => clearTimeout(timeout))
    } else {
      setShowPermission(false)
    }
  })

  const render = ToolRegistry.render(part.tool) ?? GenericTool

  return (
    <div data-component="tool-part-wrapper" data-permission={showPermission()} data-question={showQuestion()}>
      <Switch>
        <Match when={part.state.status === "error" && part.state.error}>
          {/* Error card rendering */}
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
        <div data-component="permission-prompt">
          {/* Permission buttons inline after tool */}
        </div>
      </Show>
      <Show when={showQuestion() && questionRequest()}>{(request) => <QuestionPrompt request={request()} />}</Show>
    </div>
  )
}
```

**Key aspects**:
- Tool parts look up associated permission/question requests
- HITL prompts (permissions, questions) render inline after the tool
- 50ms delay before showing HITL prompts (animation timing)
- Tool-specific renderers via `ToolRegistry`
- Locked state prevents collapsing while HITL is active

### Pattern 1.4: Inline HITL Question Rendering

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:1384-1624`

```typescript
function QuestionPrompt(props: { request: QuestionRequest }) {
  const data = useData()
  const i18n = useI18n()
  const questions = createMemo(() => props.request.questions)
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)

  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    editing: false,
  })

  // Multi-question tab interface or single-question immediate response
  return (
    <div data-component="question-prompt">
      <Show when={!single()}>
        <div data-slot="question-tabs">
          {/* Tab navigation for multi-question flows */}
        </div>
      </Show>

      <Show when={!confirm()}>
        <div data-slot="question-content">
          <div data-slot="question-text">{question()?.question}</div>
          <div data-slot="question-options">
            <For each={options()}>
              {(opt, i) => (
                <button data-slot="question-option" data-picked={picked()} onClick={() => selectOption(i())}>
                  {/* Option rendering */}
                </button>
              )}
            </For>
            {/* Custom answer input */}
          </div>
        </div>
      </Show>

      <Show when={confirm()}>
        <div data-slot="question-review">
          {/* Review all answers before submit */}
        </div>
      </Show>

      <div data-slot="question-actions">
        <Button variant="ghost" size="small" onClick={reject}>
          {i18n.t("ui.common.dismiss")}
        </Button>
        {/* Submit/next buttons */}
      </div>
    </div>
  )
}
```

**Key aspects**:
- Questions render inline within the tool part wrapper
- Single-question mode submits immediately on selection
- Multi-question mode uses tabs and confirmation step
- Custom answer input available for all questions
- Review screen shows all answers before final submit

---

## 2. Streaming Update Patterns

### Pattern 2.1: Throttled Text Streaming

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:116-147`

```typescript
const TEXT_RENDER_THROTTLE_MS = 100

function createThrottledValue(getValue: () => string) {
  const [value, setValue] = createSignal(getValue())
  let timeout: ReturnType<typeof setTimeout> | undefined
  let last = 0

  createEffect(() => {
    const next = getValue()
    const now = Date.now()
    const remaining = TEXT_RENDER_THROTTLE_MS - (now - last)
    if (remaining <= 0) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = undefined
      }
      last = now
      setValue(next)
      return
    }
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      last = Date.now()
      setValue(next)
      timeout = undefined
    }, remaining)
  })

  onCleanup(() => {
    if (timeout) clearTimeout(timeout)
  })

  return value
}
```

**Usage in text part**:
```typescript
PART_MAPPING["text"] = function TextPartDisplay(props) {
  const part = props.part as TextPart
  const displayText = () => relativizeProjectPaths((part.text ?? "").trim(), data.directory)
  const throttledText = createThrottledValue(displayText)
  
  return (
    <Show when={throttledText()}>
      <div data-component="text-part">
        <div data-slot="text-part-body">
          <Markdown text={throttledText()} cacheKey={part.id} />
        </div>
      </div>
    </Show>
  )
}
```

**Key aspects**:
- Text updates throttled to 100ms intervals during streaming
- Prevents excessive re-renders while content is arriving
- Uses timeout to ensure last update is always rendered
- Applied to both text parts and reasoning parts

### Pattern 2.2: Auto-Scroll During Streaming

**Location**: `docs/opencode/packages/ui/src/hooks/create-auto-scroll.tsx:1-245`

```typescript
export interface AutoScrollOptions {
  working: () => boolean
  onUserInteracted?: () => void
  overflowAnchor?: "none" | "auto" | "dynamic"
  bottomThreshold?: number
}

export function createAutoScroll(options: AutoScrollOptions) {
  let scroll: HTMLElement | undefined
  let settling = false
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let autoTimer: ReturnType<typeof setTimeout> | undefined
  let cleanup: (() => void) | undefined
  let auto: { top: number; time: number } | undefined

  const [store, setStore] = createStore({
    contentRef: undefined as HTMLElement | undefined,
    userScrolled: false,
  })

  const active = () => options.working() || settling

  const distanceFromBottom = (el: HTMLElement) => {
    return el.scrollHeight - el.clientHeight - el.scrollTop
  }

  // Track auto-scroll vs user-scroll with timing window
  const markAuto = (el: HTMLElement) => {
    auto = {
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now(),
    }

    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = setTimeout(() => {
      auto = undefined
      autoTimer = undefined
    }, 250)
  }

  const isAuto = (el: HTMLElement) => {
    const a = auto
    if (!a) return false
    if (Date.now() - a.time > 250) {
      auto = undefined
      return false
    }
    return Math.abs(el.scrollTop - a.top) < 2
  }

  const scrollToBottom = (force: boolean) => {
    if (!force && !active()) return
    const el = scroll
    if (!el) return

    if (!force && store.userScrolled) return
    if (force && store.userScrolled) setStore("userScrolled", false)

    const distance = distanceFromBottom(el)
    if (distance < 2) return

    // Immediate updates during streaming (no smooth animation)
    scrollToBottomNow("auto")
  }

  const handleWheel = (e: WheelEvent) => {
    if (e.deltaY >= 0) return
    // Detect nested scrollable regions (tool output, code blocks)
    const el = scroll
    const target = e.target instanceof Element ? e.target : undefined
    const nested = target?.closest("[data-scrollable]")
    if (el && nested && nested !== el) return
    stop()
  }

  const handleScroll = () => {
    const el = scroll
    if (!el) return

    if (distanceFromBottom(el) < threshold()) {
      if (store.userScrolled) setStore("userScrolled", false)
      return
    }

    // Ignore scroll events from our own scrollToBottom calls
    if (!store.userScrolled && isAuto(el)) {
      scrollToBottom(false)
      return
    }

    stop()
  }

  // ResizeObserver tracks content height changes during streaming
  createResizeObserver(
    () => store.contentRef,
    () => {
      const el = scroll
      if (el && !canScroll(el)) {
        if (store.userScrolled) setStore("userScrolled", false)
        return
      }
      if (!active()) return
      if (store.userScrolled) return
      // Keep bottom locked during streaming
      scrollToBottom(false)
    },
  )

  return {
    scrollRef: (el: HTMLElement | undefined) => { /* ... */ },
    contentRef: (el: HTMLElement | undefined) => setStore("contentRef", el),
    handleScroll,
    handleInteraction,
    pause: stop,
    resume: () => { /* ... */ },
    userScrolled: () => store.userScrolled,
  }
}
```

**Usage in SessionTurn**:  
**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:489-617`

```typescript
const autoScroll = createAutoScroll({
  working,
  onUserInteracted: props.onUserInteracted,
  overflowAnchor: "auto",
})

return (
  <div data-component="session-turn" class={props.classes?.root} ref={setRootRef}>
    <div
      ref={autoScroll.scrollRef}
      onScroll={autoScroll.handleScroll}
      data-slot="session-turn-content"
      class={props.classes?.content}
    >
      <div onClick={autoScroll.handleInteraction}>
        <Show when={message()}>
          {(msg) => (
            <div
              ref={autoScroll.contentRef}
              data-message={msg().id}
              data-slot="session-turn-message-container"
              class={props.classes?.container}
            >
              {/* Message content */}
            </div>
          )}
        </Show>
      </div>
    </div>
  </div>
)
```

**Key aspects**:
- `scrollRef` attaches to scrollable container
- `contentRef` attaches to dynamic content being measured
- ResizeObserver triggers scroll on content size changes
- 250ms window to distinguish auto-scroll from user-scroll events
- Nested scrollable regions (marked with `[data-scrollable]`) don't trigger "stop following"
- `working()` signal controls whether auto-scroll is active
- Settling period (300ms) after work completes before disabling auto-scroll

### Pattern 2.3: Incremental Part Array Updates

**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:148-183`

```typescript
function AssistantMessageItem(props: {
  message: AssistantMessage
  responsePartId: string | undefined
  hideResponsePart: boolean
  hideReasoning: boolean
  hidden?: () => readonly { messageID: string; callID: string }[]
}) {
  const data = useData()
  const emptyParts: PartType[] = []
  const msgParts = createMemo(() => list(data.store.part?.[props.message.id], emptyParts))
  
  const lastTextPart = createMemo(() => {
    const parts = msgParts()
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i]
      if (part?.type === "text") return part as TextPart
    }
    return undefined
  })

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

  return <Message message={props.message} parts={filteredParts()} />
}
```

**Key aspects**:
- Parts array updated incrementally as streaming progresses
- Reactive memos re-filter parts array on each update
- Last text part hidden if it's the response summary (shown separately)
- Reasoning parts hidden after completion
- Tool parts can be hidden when HITL prompt is active

---

## 3. Sub-Agent/Tool Lifecycle Patterns

### Pattern 3.1: Tool Status Tracking

**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:381-428`

```typescript
const rawStatus = createMemo(() => {
  const msgs = assistantMessages()
  let last: PartType | undefined
  let currentTask: ToolPart | undefined

  for (let mi = msgs.length - 1; mi >= 0; mi--) {
    const msgParts = list(data.store.part?.[msgs[mi].id], emptyParts)
    for (let pi = msgParts.length - 1; pi >= 0; pi--) {
      const part = msgParts[pi]
      if (!part) continue
      if (!last) last = part

      if (
        part.type === "tool" &&
        part.tool === "task" &&
        part.state &&
        "metadata" in part.state &&
        part.state.metadata?.sessionId &&
        part.state.status === "running"
      ) {
        currentTask = part as ToolPart
        break
      }
    }
    if (currentTask) break
  }

  const taskSessionId =
    currentTask?.state && "metadata" in currentTask.state
      ? (currentTask.state.metadata?.sessionId as string | undefined)
      : undefined

  if (taskSessionId) {
    const taskMessages = list(data.store.message?.[taskSessionId], emptyMessages)
    for (let mi = taskMessages.length - 1; mi >= 0; mi--) {
      const msg = taskMessages[mi]
      if (!msg || msg.role !== "assistant") continue

      const msgParts = list(data.store.part?.[msg.id], emptyParts)
      for (let pi = msgParts.length - 1; pi >= 0; pi--) {
        const part = msgParts[pi]
        if (part) return computeStatusFromPart(part, i18n.t)
      }
    }
  }

  return computeStatusFromPart(last, i18n.t)
})
```

**Status computation**:  
**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:83-120`

```typescript
function computeStatusFromPart(part: PartType | undefined, t: Translator): string | undefined {
  if (!part) return undefined

  if (part.type === "tool") {
    switch (part.tool) {
      case "task":
        return t("ui.sessionTurn.status.delegating")
      case "todowrite":
      case "todoread":
        return t("ui.sessionTurn.status.planning")
      case "read":
        return t("ui.sessionTurn.status.gatheringContext")
      case "list":
      case "grep":
      case "glob":
        return t("ui.sessionTurn.status.searchingCodebase")
      case "webfetch":
        return t("ui.sessionTurn.status.searchingWeb")
      case "edit":
      case "write":
        return t("ui.sessionTurn.status.makingEdits")
      case "bash":
        return t("ui.sessionTurn.status.runningCommands")
      default:
        return undefined
    }
  }
  if (part.type === "reasoning") {
    const text = part.text ?? ""
    const match = text.trimStart().match(/^\*\*(.+?)\*\*/)
    if (match) return t("ui.sessionTurn.status.thinkingWithTopic", { topic: match[1].trim() })
    return t("ui.sessionTurn.status.thinking")
  }
  if (part.type === "text") {
    return t("ui.sessionTurn.status.gatheringThoughts")
  }
  return undefined
}
```

**Key aspects**:
- Status computed from last non-completed part
- For sub-agent tasks, looks into child session for deeper status
- Different status messages per tool type
- Reasoning parts can extract topic from markdown headers
- Status updated continuously during streaming

### Pattern 3.2: Nested Sub-Agent Tool Rendering

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:874-1077`

```typescript
ToolRegistry.register({
  name: "task",
  render(props) {
    const data = useData()
    const i18n = useI18n()
    const childSessionId = () => props.metadata.sessionId as string | undefined

    const childToolParts = createMemo(() => {
      const sessionId = childSessionId()
      if (!sessionId) return []
      return getSessionToolParts(data.store, sessionId)
    })

    const autoScroll = createAutoScroll({
      working: () => true,
      overflowAnchor: "auto",
    })

    const childPermission = createMemo(() => {
      const sessionId = childSessionId()
      if (!sessionId) return undefined
      const permissions = data.store.permission?.[sessionId] ?? []
      return permissions[0]
    })

    const childToolPart = createMemo(() => {
      const perm = childPermission()
      if (!perm || !perm.tool) return undefined
      const sessionId = childSessionId()
      if (!sessionId) return undefined
      // Find the tool part that matches the permission's callID
      const messages = data.store.message[sessionId] ?? []
      const message = findLast(messages, (m) => m.id === perm.tool!.messageID)
      if (!message) return undefined
      const parts = data.store.part[message.id] ?? []
      for (const part of parts) {
        if (part.type === "tool" && (part as ToolPart).callID === perm.tool!.callID) {
          return { part: part as ToolPart, message }
        }
      }
      return undefined
    })

    return (
      <div data-component="tool-part-wrapper" data-permission={!!childPermission()}>
        <Switch>
          <Match when={childPermission()}>
            <>
              <Show when={childToolPart()} fallback={<BasicTool icon="task" defaultOpen={true} trigger={trigger()} />}>
                {renderChildToolPart()}
              </Show>
              <div data-component="permission-prompt">
                {/* Permission buttons for child tool */}
              </div>
            </>
          </Match>
          <Match when={true}>
            <BasicTool icon="task" defaultOpen={true} trigger={trigger()}>
              <div
                ref={autoScroll.scrollRef}
                onScroll={autoScroll.handleScroll}
                data-component="tool-output"
                data-scrollable
              >
                <div ref={autoScroll.contentRef} data-component="task-tools">
                  <For each={childToolParts()}>
                    {(item) => {
                      const info = createMemo(() => getToolInfo(item.tool, item.state.input))
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
          </Match>
        </Switch>
      </div>
    )
  },
})
```

**Key aspects**:
- Sub-agent sessions have their own message/part arrays
- Tool list from child session rendered inline
- Child permissions bubble up to parent tool display
- Nested scrollable region with its own auto-scroll
- Child tool expanded when permission is active

### Pattern 3.3: Tool State Machine

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:499-534`

```typescript
export interface ToolProps {
  input: Record<string, any>
  metadata: Record<string, any>
  tool: string
  output?: string
  status?: string  // "running" | "completed" | "error"
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  locked?: boolean
}

export type ToolComponent = Component<ToolProps>

export function registerTool(input: { name: string; render?: ToolComponent }) {
  state[input.name] = input
  return input
}

export function getTool(name: string) {
  return state[name]?.render
}
```

**Tool lifecycle states**:
- **Not started**: Tool part doesn't exist yet
- **Running**: `part.state.status === "running"` - Tool is executing
- **Completed**: `part.state.status === "completed"` - Tool has output
- **Error**: `part.state.status === "error"` - Tool failed with error

**State affects rendering**:
```typescript
<Switch>
  <Match when={part.state.status === "error" && part.state.error}>
    {/* Render error card */}
  </Match>
  <Match when={true}>
    {/* Render normal tool with collapsible content */}
  </Match>
</Switch>
```

---

## 4. Ask Question / HITL Patterns

### Pattern 4.1: Question Request Data Flow

**Location**: `docs/opencode/packages/ui/src/context/data.tsx:1-83`

```typescript
type Data = {
  session: Session[]
  session_status: {
    [sessionID: string]: SessionStatus
  }
  permission?: {
    [sessionID: string]: PermissionRequest[]
  }
  question?: {
    [sessionID: string]: QuestionRequest[]
  }
  message: {
    [sessionID: string]: Message[]
  }
  part: {
    [messageID: string]: Part[]
  }
}

export type QuestionReplyFn = (input: { requestID: string; answers: QuestionAnswer[] }) => void
export type QuestionRejectFn = (input: { requestID: string }) => void

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: {
    data: Data
    directory: string
    onQuestionReply?: QuestionReplyFn
    onQuestionReject?: QuestionRejectFn
    // ...
  }) => {
    return {
      get store() {
        return props.data
      },
      replyToQuestion: props.onQuestionReply,
      rejectQuestion: props.onQuestionReject,
      // ...
    }
  },
})
```

**Key aspects**:
- Questions stored in session-scoped array
- First question in array is the active one
- Reply/reject functions passed down via context
- Answers are array of string arrays (multi-question support)

### Pattern 4.2: Inline Question Detection and Rendering

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:547-575`

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

const [forceOpen, setForceOpen] = createSignal(false)
createEffect(() => {
  if (permission() || questionRequest()) setForceOpen(true)
})
```

**Rendering**:
```typescript
return (
  <div data-component="tool-part-wrapper" data-question={showQuestion()}>
    {/* Tool rendering */}
    <Show when={showQuestion() && questionRequest()}>
      {(request) => <QuestionPrompt request={request()} />}
    </Show>
  </div>
)
```

**Key aspects**:
- Question matched to tool via `callID`
- 50ms delay before showing (smooth appearance)
- Tool auto-expands and locks open when question appears
- Question renders inline after tool output

### Pattern 4.3: Answered Questions in Collapsed View

**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:341-362`

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

**Rendering**:
```typescript
<Show when={!props.stepsExpanded && answeredQuestionParts().length > 0}>
  <div data-slot="session-turn-answered-question-parts">
    <For each={answeredQuestionParts()}>
      {({ part, message }) => <Part part={part} message={message} />}
    </For>
  </div>
</Show>
```

**Key aspects**:
- Answered questions shown in collapsed view
- Active questions hidden (would be in expanded view)
- Questions with answers stored in tool metadata
- Allows seeing Q&A summary without expanding full trace

### Pattern 4.4: Question Tool Rendering

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:1339-1382`

```typescript
ToolRegistry.register({
  name: "question",
  render(props) {
    const i18n = useI18n()
    const questions = createMemo(() => (props.input.questions ?? []) as QuestionInfo[])
    const answers = createMemo(() => (props.metadata.answers ?? []) as QuestionAnswer[])
    const completed = createMemo(() => answers().length > 0)

    const subtitle = createMemo(() => {
      const count = questions().length
      if (count === 0) return ""
      if (completed()) return i18n.t("ui.question.subtitle.answered", { count })
      return `${count} ${i18n.t(count > 1 ? "ui.common.question.other" : "ui.common.question.one")}`
    })

    return (
      <BasicTool
        {...props}
        defaultOpen={completed()}
        icon="bubble-5"
        trigger={{
          title: i18n.t("ui.tool.questions"),
          subtitle: subtitle(),
        }}
      >
        <Show when={completed()}>
          <div data-component="question-answers">
            <For each={questions()}>
              {(q, i) => {
                const answer = () => answers()[i()] ?? []
                return (
                  <div data-slot="question-answer-item">
                    <div data-slot="question-text">{q.question}</div>
                    <div data-slot="answer-text">{answer().join(", ") || i18n.t("ui.question.answer.none")}</div>
                  </div>
                )
              }}
            </For>
          </div>
        </Show>
      </BasicTool>
    )
  },
})
```

**Key aspects**:
- Tool collapsed until answered
- Shows question count in subtitle
- After answering, expands by default to show Q&A pairs
- Multiple questions/answers displayed in order

---

## 5. Content Offset/Ordering Patterns

### Pattern 5.1: User Message with Inline File References

**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:304-443`

```typescript
export function UserMessageDisplay(props: { message: UserMessage; parts: PartType[] }) {
  const textPart = createMemo(
    () => props.parts?.find((p) => p.type === "text" && !(p as TextPart).synthetic) as TextPart | undefined,
  )

  const text = createMemo(() => textPart()?.text || "")

  const files = createMemo(() => (props.parts?.filter((p) => p.type === "file") as FilePart[]) ?? [])

  const attachments = createMemo(() =>
    files()?.filter((f) => {
      const mime = f.mime
      return mime.startsWith("image/") || mime === "application/pdf"
    }),
  )

  const inlineFiles = createMemo(() =>
    files().filter((f) => {
      const mime = f.mime
      return !mime.startsWith("image/") && mime !== "application/pdf" && f.source?.text?.start !== undefined
    }),
  )

  const agents = createMemo(() => (props.parts?.filter((p) => p.type === "agent") as AgentPart[]) ?? [])

  return (
    <div data-component="user-message" data-expanded={expanded()} data-can-expand={canExpand()}>
      <Show when={attachments().length > 0}>
        <div data-slot="user-message-attachments">
          {/* Image/PDF previews */}
        </div>
      </Show>
      <Show when={text()}>
        <div data-slot="user-message-text">
          <HighlightedText text={text()} references={inlineFiles()} agents={agents()} />
        </div>
      </Show>
    </div>
  )
}
```

**Inline reference highlighting**:  
**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:447-482`

```typescript
function HighlightedText(props: { text: string; references: FilePart[]; agents: AgentPart[] }) {
  const segments = createMemo(() => {
    const text = props.text

    const allRefs: { start: number; end: number; type: "file" | "agent" }[] = [
      ...props.references
        .filter((r) => r.source?.text?.start !== undefined && r.source?.text?.end !== undefined)
        .map((r) => ({ start: r.source!.text!.start, end: r.source!.text!.end, type: "file" as const })),
      ...props.agents
        .filter((a) => a.source?.start !== undefined && a.source?.end !== undefined)
        .map((a) => ({ start: a.source!.start, end: a.source!.end, type: "agent" as const })),
    ].sort((a, b) => a.start - b.start)

    const result: HighlightSegment[] = []
    let lastIndex = 0

    for (const ref of allRefs) {
      if (ref.start < lastIndex) continue

      if (ref.start > lastIndex) {
        result.push({ text: text.slice(lastIndex, ref.start) })
      }

      result.push({ text: text.slice(ref.start, ref.end), type: ref.type })
      lastIndex = ref.end
    }

    if (lastIndex < text.length) {
      result.push({ text: text.slice(lastIndex) })
    }

    return result
  })

  return <For each={segments()}>{(segment) => <span data-highlight={segment.type}>{segment.text}</span>}</For>
}
```

**Key aspects**:
- Attachments (images/PDFs) displayed first
- Text with inline references highlighted via character offsets
- File and agent references stored with `start`/`end` positions
- Text segmented and marked with `data-highlight` attribute
- Non-highlighted segments rendered as plain spans

### Pattern 5.2: Turn-Level Content Layout

**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:610-825`

```typescript
return (
  <div data-component="session-turn" class={props.classes?.root} ref={setRootRef}>
    <div
      ref={autoScroll.scrollRef}
      onScroll={autoScroll.handleScroll}
      data-slot="session-turn-content"
      class={props.classes?.content}
    >
      <div onClick={autoScroll.handleInteraction}>
        <Show when={message()}>
          {(msg) => (
            <div
              ref={autoScroll.contentRef}
              data-message={msg().id}
              data-slot="session-turn-message-container"
              class={props.classes?.container}
            >
              <Switch>
                <Match when={isShellMode()}>
                  <Part part={shellModePart()!} message={msg()} defaultOpen />
                </Match>
                <Match when={true}>
                  {/* 1. Attachments */}
                  <Show when={attachmentParts().length > 0}>
                    <div data-slot="session-turn-attachments" aria-live="off">
                      <Message message={msg()} parts={attachmentParts()} />
                    </div>
                  </Show>
                  
                  {/* 2. Sticky header with user message + status */}
                  <div data-slot="session-turn-sticky" ref={setStickyRef}>
                    {/* User Message */}
                    <div data-slot="session-turn-message-content" aria-live="off">
                      <Message message={msg()} parts={stickyParts()} />
                    </div>

                    {/* Trigger (sticky) - Working status or expand/collapse */}
                    <Show when={working() || hasSteps()}>
                      <div data-slot="session-turn-response-trigger">
                        <Button onClick={props.onStepsExpandedToggle}>
                          {/* Status text, duration, spinner */}
                        </Button>
                      </div>
                    </Show>
                  </div>
                  
                  {/* 3. Expanded steps (all assistant messages and tools) */}
                  <Show when={props.stepsExpanded && assistantMessages().length > 0}>
                    <div data-slot="session-turn-collapsible-content-inner">
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
                    </div>
                  </Show>
                  
                  {/* 4. Answered questions (in collapsed view) */}
                  <Show when={!props.stepsExpanded && answeredQuestionParts().length > 0}>
                    <div data-slot="session-turn-answered-question-parts">
                      <For each={answeredQuestionParts()}>
                        {({ part, message }) => <Part part={part} message={message} />}
                      </For>
                    </div>
                  </Show>
                  
                  {/* 5. Response summary */}
                  <Show when={!working() && response()}>
                    <div data-slot="session-turn-summary-section">
                      <div data-slot="session-turn-summary-header">
                        <h2>{i18n.t("ui.sessionTurn.summary.response")}</h2>
                      </div>
                      <div data-slot="session-turn-response">
                        <Markdown text={response() ?? ""} cacheKey={responsePartId()} />
                      </div>
                    </div>
                  </Show>
                  
                  {/* 6. Error display */}
                  <Show when={error() && !props.stepsExpanded}>
                    <Card variant="error">{errorText()}</Card>
                  </Show>
                </Match>
              </Switch>
            </div>
          )}
        </Show>
        {props.children}
      </div>
    </div>
  </div>
)
```

**Ordering logic**:
1. **Attachments** - Images/PDFs from user message (if any)
2. **Sticky section** - User message text + working status/expand button
3. **Expanded steps** - All assistant messages with their parts (if expanded)
4. **Answered questions** - Q&A summary (if collapsed and questions answered)
5. **Response summary** - Final text response (if completed)
6. **Error** - Error message (if failed and collapsed)

**Key aspects**:
- Sticky header remains visible while scrolling
- CSS variable `--session-turn-sticky-height` tracks sticky section height
- Response text extracted from last text part and shown separately
- Steps can be collapsed to hide intermediate tool calls
- Shell mode shortcuts directly to bash tool rendering

---

## 6. Component Composition Patterns

### Pattern 6.1: Collapsible Tool Structure

**Location**: `docs/opencode/packages/ui/src/components/basic-tool.tsx:21-114`

```typescript
export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  locked?: boolean
  onSubtitleClick?: () => void
}

export function BasicTool(props: BasicToolProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? false)

  createEffect(() => {
    if (props.forceOpen) setOpen(true)
  })

  const handleOpenChange = (value: boolean) => {
    if (props.locked && !value) return  // Can't close if locked
    setOpen(value)
  }

  return (
    <Collapsible open={open()} onOpenChange={handleOpenChange}>
      <Collapsible.Trigger>
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <Icon name={props.icon} size="small" />
            <div data-slot="basic-tool-tool-info">
              <Switch>
                <Match when={isTriggerTitle(props.trigger) && props.trigger}>
                  {(trigger) => (
                    <div data-slot="basic-tool-tool-info-structured">
                      <div data-slot="basic-tool-tool-info-main">
                        <span data-slot="basic-tool-tool-title">{trigger().title}</span>
                        <Show when={trigger().subtitle}>
                          <span data-slot="basic-tool-tool-subtitle">{trigger().subtitle}</span>
                        </Show>
                        <Show when={trigger().args?.length}>
                          <For each={trigger().args}>
                            {(arg) => <span data-slot="basic-tool-tool-arg">{arg}</span>}
                          </For>
                        </Show>
                      </div>
                      <Show when={trigger().action}>{trigger().action}</Show>
                    </div>
                  )}
                </Match>
                <Match when={true}>{props.trigger as JSX.Element}</Match>
              </Switch>
            </div>
          </div>
          <Show when={props.children && !props.hideDetails && !props.locked}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={props.children && !props.hideDetails}>
        <Collapsible.Content>{props.children}</Collapsible.Content>
      </Show>
    </Collapsible>
  )
}
```

**Key aspects**:
- All tools share this collapsible structure
- Trigger shows: icon + title + subtitle + args + optional action
- Arrow indicator only shown if tool has collapsible content
- `locked` prop prevents closing (used during HITL)
- `forceOpen` automatically expands tool
- Content hidden if `hideDetails` is true

### Pattern 6.2: Tool-Specific Renderers

**Edit tool example**:  
**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:1102-1153`

```typescript
ToolRegistry.register({
  name: "edit",
  render(props) {
    const i18n = useI18n()
    const diffComponent = useDiffComponent()
    const diagnostics = createMemo(() => getDiagnostics(props.metadata.diagnostics, props.input.filePath))
    const filename = () => getFilename(props.input.filePath ?? "")
    
    return (
      <BasicTool
        {...props}
        icon="code-lines"
        trigger={
          <div data-component="edit-trigger">
            <div data-slot="message-part-title-area">
              <div data-slot="message-part-title">
                <span data-slot="message-part-title-text">{i18n.t("ui.messagePart.title.edit")}</span>
                <span data-slot="message-part-title-filename">{filename()}</span>
              </div>
              <Show when={props.input.filePath?.includes("/")}>
                <div data-slot="message-part-path">
                  <span data-slot="message-part-directory">{getDirectory(props.input.filePath!)}</span>
                </div>
              </Show>
            </div>
            <div data-slot="message-part-actions">
              <Show when={props.metadata.filediff}>
                <DiffChanges changes={props.metadata.filediff} />
              </Show>
            </div>
          </div>
        }
      >
        <Show when={props.metadata.filediff?.path || props.input.filePath}>
          <div data-component="edit-content">
            <Dynamic
              component={diffComponent}
              before={{
                name: props.metadata?.filediff?.file || props.input.filePath,
                contents: props.metadata?.filediff?.before || props.input.oldString,
              }}
              after={{
                name: props.metadata?.filediff?.file || props.input.filePath,
                contents: props.metadata?.filediff?.after || props.input.newString,
              }}
            />
          </div>
        </Show>
        <DiagnosticsDisplay diagnostics={diagnostics()} />
      </BasicTool>
    )
  },
})
```

**Bash tool example**:  
**Location**: `docs/opencode/packages/ui/src/components/message-part.tsx:1079-1100`

```typescript
ToolRegistry.register({
  name: "bash",
  render(props) {
    const i18n = useI18n()
    return (
      <BasicTool
        {...props}
        icon="console"
        trigger={{
          title: i18n.t("ui.tool.shell"),
          subtitle: props.input.description,
        }}
      >
        <div data-component="tool-output" data-scrollable>
          <Markdown
            text={`\`\`\`command\n$ ${props.input.command ?? props.metadata.command ?? ""}${props.output || props.metadata.output ? "\n\n" + stripAnsi(props.output || props.metadata.output) : ""}\n\`\`\``}
          />
        </div>
      </BasicTool>
    )
  },
})
```

**Key aspects**:
- Each tool registers a custom renderer
- Custom triggers for complex layouts (edit/write)
- Simple trigger objects for basic tools (bash/read/glob)
- Tool content uses context-injected components (diff, code viewers)
- Metadata and input props contain tool-specific data
- Markdown rendering for output with syntax highlighting

### Pattern 6.3: Sticky Header with Dynamic Height

**Location**: `docs/opencode/packages/ui/src/components/session-turn.tsx:460-511`

```typescript
const [rootRef, setRootRef] = createSignal<HTMLDivElement | undefined>()
const [stickyRef, setStickyRef] = createSignal<HTMLDivElement | undefined>()

const updateStickyHeight = (height: number) => {
  const root = rootRef()
  if (!root) return
  const next = Math.ceil(height)
  root.style.setProperty("--session-turn-sticky-height", `${next}px`)
}

createResizeObserver(
  () => stickyRef(),
  ({ height }) => {
    updateStickyHeight(height)
  },
)

createEffect(() => {
  const root = rootRef()
  if (!root) return
  const sticky = stickyRef()
  if (!sticky) {
    root.style.setProperty("--session-turn-sticky-height", "0px")
    return
  }
  updateStickyHeight(sticky.getBoundingClientRect().height)
})
```

**CSS usage** (implied):
```css
[data-slot="session-turn-sticky"] {
  position: sticky;
  top: 0;
  z-index: 10;
}

[data-slot="session-turn-collapsible-content-inner"] {
  /* Offset by sticky height so content doesn't hide behind it */
  padding-top: var(--session-turn-sticky-height);
}
```

**Key aspects**:
- ResizeObserver tracks sticky section height changes
- Height stored as CSS variable on root element
- Content below offset by sticky height to prevent overlap
- Handles dynamic content in sticky section (multi-line text)

### Pattern 6.4: Nested Scrollable Regions

**Bash tool with scrollable output**:
```typescript
<div data-component="tool-output" data-scrollable>
  <Markdown text={output} />
</div>
```

**Sub-agent task tool with scrollable tool list**:
```typescript
<div
  ref={autoScroll.scrollRef}
  onScroll={autoScroll.handleScroll}
  data-component="tool-output"
  data-scrollable
>
  <div ref={autoScroll.contentRef} data-component="task-tools">
    <For each={childToolParts()}>
      {(item) => <div data-slot="task-tool-item">{/* ... */}</div>}
    </For>
  </div>
</div>
```

**Auto-scroll detection for nested regions**:  
**Location**: `docs/opencode/packages/ui/src/hooks/create-auto-scroll.tsx:108-118`

```typescript
const handleWheel = (e: WheelEvent) => {
  if (e.deltaY >= 0) return
  // If the user is scrolling within a nested scrollable region (tool output,
  // code block, etc), don't treat it as leaving the "follow bottom" mode.
  // Those regions opt in via `data-scrollable`.
  const el = scroll
  const target = e.target instanceof Element ? e.target : undefined
  const nested = target?.closest("[data-scrollable]")
  if (el && nested && nested !== el) return
  stop()
}
```

**Key aspects**:
- Nested scrollable regions marked with `data-scrollable` attribute
- Parent auto-scroll ignores wheel events in nested regions
- Nested regions can have their own auto-scroll behavior
- Prevents "scroll bleed" where nested scroll affects parent

---

## Summary

### Data Flow Architecture

1. **State Store**: Centralized reactive store with session/message/part hierarchy
2. **Parts Array**: Messages contain ordered array of parts that update incrementally
3. **Reactive Memos**: Computed values update automatically as store changes
4. **Context Providers**: Data and callbacks flow down via context

### Rendering Strategy

1. **Dynamic Dispatch**: Part types and tool names map to specific renderers
2. **Incremental Updates**: Throttled text rendering + auto-scroll for streaming
3. **Inline Components**: HITL prompts, tool outputs, sub-agents all inline
4. **Collapsible Structure**: Tools use shared collapsible component pattern

### User Interaction

1. **Auto-Scroll**: Follows bottom during streaming, stops on user scroll
2. **Expand/Collapse**: Steps section toggles to show/hide tool trace
3. **HITL Responses**: Permissions and questions render inline, lock tool open
4. **Nested Navigation**: Sub-agent links, file viewing, diff expansion

### Key Design Principles

- **Streaming-first**: All updates assume incremental content arrival
- **Inline everything**: No separate panels - HITL, tools, errors all inline
- **Progressive disclosure**: Collapsed by default, expand for details
- **Resilient rendering**: Handle missing data, delayed content gracefully
- **Accessible**: ARIA labels, keyboard navigation, screen reader support
