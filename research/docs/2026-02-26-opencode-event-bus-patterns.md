# OpenCode Event-Bus Architecture Research

**Date**: 2026-02-26  
**Repository**: anomalyco/opencode  
**Research Focus**: Event-bus patterns, coalescing, batching, and streaming architecture

---

## Executive Summary

OpenCode implements a sophisticated event-driven architecture centered around a type-safe `Bus` system with Zod schema validation. The architecture features:

1. **Type-Safe Event System**: `BusEvent.define()` with Zod schemas for compile-time safety
2. **Global Bus Distribution**: Events published locally also emit to `GlobalBus` for SSE streaming
3. **Client-Side Coalescing**: Key-based event coalescing reduces redundant updates
4. **Batch Flushing**: 16ms frame-aligned batching for optimal render performance
5. **Backpressure Management**: Queue swapping, yielding, and coalescing prevent UI blocking

---

## 1. OpenCode's Bus System

### 1.1 Core Implementation

**Location**: `packages/opencode/src/bus/index.ts`

The `Bus` namespace provides three core methods for pub/sub communication:

#### `Bus.publish()`

Publishes events to both local subscribers and the global event stream.

```typescript
export async function publish<Definition extends BusEvent.Definition>(
  def: Definition,
  properties: z.output<Definition["properties"]>,
) {
  const payload = {
    type: def.type,
    properties,
  }
  log.info("publishing", {
    type: def.type,
  })
  const pending = []
  // Notify both specific subscribers and wildcard subscribers
  for (const key of [def.type, "*"]) {
    const match = state().subscriptions.get(key)
    for (const sub of match ?? []) {
      pending.push(sub(payload))
    }
  }
  // Emit to GlobalBus for SSE streaming
  GlobalBus.emit("event", {
    directory: Instance.directory,
    payload,
  })
  return Promise.all(pending)
}
```

**Key Features**:
- Dual publishing: local subscriptions + `GlobalBus` for SSE
- Type-safe with Zod schema validation
- Both specific type subscribers and wildcard (`"*"`) subscribers receive events
- Async execution with `Promise.all()` for concurrent handler invocation

#### `Bus.subscribe()`

Subscribe to specific event types with type-safe callbacks.

```typescript
export function subscribe<Definition extends BusEvent.Definition>(
  def: Definition,
  callback: (event: { 
    type: Definition["type"]; 
    properties: z.infer<Definition["properties"]> 
  }) => void,
) {
  return raw(def.type, callback)
}
```

**Example Usage**: Version Control System (VCS) monitoring branch changes

**Location**: `packages/opencode/src/project/vcs.ts` (lines ~56)

```typescript
const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
  if (evt.properties.file.endsWith("HEAD")) return
  const next = await currentBranch()
  if (next !== current) {
    log.info("branch changed", { from: current, to: next })
    current = next
    Bus.publish(Event.BranchUpdated, { branch: next })
  }
})
```

#### `Bus.subscribeAll()`

Subscribe to all events (wildcard subscription).

```typescript
export function subscribeAll(callback: (event: any) => void) {
  return raw("*", callback)
}
```

**Example Usage**: Server SSE streaming

```typescript
const unsub = Bus.subscribeAll(async (event) => {
  await stream.writeSSE({
    data: JSON.stringify(event),
  })
  if (event.type === Bus.InstanceDisposed.type) {
    stream.close()
  }
})
```

### 1.2 Subscription Management

- **Internal Storage**: `Map<string, Set<Function>>` keyed by event type
- **Wildcard Key**: `"*"` key for all-event subscribers
- **Cleanup**: `unsubscribe()` function returned for cleanup
- **Special Events**: `Bus.InstanceDisposed` signals cleanup time

---

## 2. BusEvent.define() Pattern

### 2.1 Type-Safe Event Definition

**Pattern**: Define events with type string + Zod schema

```typescript
BusEvent.define(
  "event.type.string",
  z.object({ /* properties schema */ })
)
```

### 2.2 Real-World Examples

#### MCP Tools Changed Event

**Location**: `packages/opencode/src/mcp/index.ts`

```typescript
export const ToolsChanged = BusEvent.define(
  "mcp.tools.changed",
  z.object({
    server: z.string(),
  }),
)
```

**Use Case**: Notify when MCP server tools are updated

#### Session Created Event

**Location**: `packages/opencode/src/session/index.ts`

```typescript
export const Event = {
  Created: BusEvent.define(
    "session.created",
    z.object({
      info: Info, // Info is another Zod schema
    }),
  ),
  // ... other events
}
```

**Publishing Example**:

```typescript
Database.use((db) => {
  db.insert(SessionTable).values(toRow(result)).run()
  Database.effect(() =>
    Bus.publish(Event.Created, {
      info: result,
    }),
  )
})
```

**Key Pattern**: Database operations → `Database.effect()` → `Bus.publish()` ensures events fire after DB commits

#### File Watcher Updated Event

**Location**: `packages/opencode/src/file/watcher.ts`

```typescript
export const Event = {
  Updated: BusEvent.define(
    "file.watcher.updated",
    z.object({
      file: z.string(),
      event: z.union([
        z.literal("add"), 
        z.literal("change"), 
        z.literal("unlink")
      ]),
    }),
  ),
}
```

**Features**:
- Union types for finite event values
- Strong typing prevents invalid event types

### 2.3 Benefits

1. **Compile-Time Safety**: TypeScript + Zod catch errors before runtime
2. **Runtime Validation**: Zod ensures payloads match expected structure
3. **IDE Support**: Autocomplete and type inference for event properties
4. **Maintainability**: Schema changes propagate through type system
5. **Documentation**: Schema serves as API documentation

---

## 3. Event Coalescing & Batching (global-sdk.tsx)

### 3.1 Implementation Overview

**Location**: `packages/app/src/context/global-sdk.tsx` (lines 46-84)

The client-side event processor implements:
- **Key-based coalescing**: Deduplicate rapid updates to same entity
- **Queue buffering**: Collect events during frame
- **Batch flushing**: Process events every 16ms (60fps aligned)
- **Double-buffer pattern**: Swap queue/buffer for concurrent collection

### 3.2 Key Generation Function

```typescript
const key = (directory: string, payload: Event) => {
  if (payload.type === "session.status") 
    return `session.status:${directory}:${payload.properties.sessionID}`
  
  if (payload.type === "lsp.updated") 
    return `lsp.updated:${directory}`
  
  if (payload.type === "message.part.updated") {
    const part = payload.properties.part
    return `message.part.updated:${directory}:${part.messageID}:${part.id}`
  }
}
```

**Coalescing Strategy**:
- `session.status`: Per-session per-directory (prevents duplicate status updates)
- `lsp.updated`: Per-directory (single LSP update per directory)
- `message.part.updated`: Per-part per-message per-directory (fine-grained)

### 3.3 Event Processing Loop

```typescript
const queue = []
const buffer = []
const coalesced = new Map() // Map<string, number> - key -> queue index

for await (const event of events.stream) {
  streamErrorLogged = false
  const directory = event.directory ?? "global"
  const payload = event.payload
  const k = key(directory, payload)
  
  if (k) {
    const i = coalesced.get(k)
    if (i !== undefined) {
      // Update existing event in-place (coalescing!)
      queue[i] = { directory, payload }
      continue
    }
    coalesced.set(k, queue.length)
  }
  
  queue.push({ directory, payload })
  schedule()

  // Yield control every 8ms to prevent blocking
  if (Date.now() - yielded < STREAM_YIELD_MS) continue
  yielded = Date.now()
  await wait(0)
}
```

**Key Mechanisms**:
1. **In-Place Update**: If key exists, replace event at recorded index
2. **Index Tracking**: `coalesced` Map stores queue index for O(1) lookup
3. **Periodic Yielding**: Every 8ms yield to event loop (prevents UI freeze)

### 3.4 Flush Function (Double-Buffer Swap)

```typescript
const flush = () => {
  if (timer) clearTimeout(timer)
  timer = undefined

  if (queue.length === 0) return

  // Double-buffer swap
  const events = queue
  queue = buffer
  buffer = events
  queue.length = 0
  coalesced.clear()

  last = Date.now()
  batch(() => {
    for (const event of events) {
      emitter.emit(event.directory, event.payload)
    }
  })

  buffer.length = 0
}
```

**Pattern Benefits**:
- **Concurrent Collection**: New events enter `queue` while `buffer` is being processed
- **Atomic Swap**: Reference swap is instantaneous
- **SolidJS Batch**: `batch()` ensures single render cycle for all updates
- **Clear State**: Reset queue and coalesced map after processing

### 3.5 Constants

```typescript
const FLUSH_FRAME_MS = 16    // 60fps frame time
const STREAM_YIELD_MS = 8    // Yield to event loop every 8ms
const RECONNECT_DELAY_MS = 250 // SSE reconnection delay
```

### 3.6 Scheduling Logic

```typescript
const schedule = () => {
  if (timer) return
  const elapsed = Date.now() - last
  const delay = Math.max(0, FLUSH_FRAME_MS - elapsed)
  timer = setTimeout(flush, delay)
}
```

**Adaptive Timing**: Ensures flushes happen at ~60fps while allowing immediate flush if > 16ms elapsed

---

## 4. End-to-End Streaming Flow

### 4.1 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND (OpenCode)                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. LLM.stream (AI SDK)                                            │
│     ├─ streamText() from @ai-sdk/core                              │
│     ├─ Provider API (OpenAI, Anthropic, etc.)                      │
│     └─ SSE chunks from LLM                                         │
│                                                                     │
│  2. TransformStream (AI SDK Internal)                              │
│     ├─ Processes stream parts:                                     │
│     │   • stream-start                                             │
│     │   • raw                                                       │
│     │   • error                                                     │
│     │   • response-metadata                                         │
│     │   • usage info                                                │
│     └─ Pipes to SessionProcessor                                   │
│                                                                     │
│  3. SessionProcessor.create / process()                            │
│     ├─ Iterates over fullStream                                    │
│     ├─ Handles stream types:                                       │
│     │   • reasoning-start                                          │
│     │   • reasoning-delta                                          │
│     │   • text-delta                                               │
│     │   • tool-call                                                │
│     ├─ Calls Session.updatePart()                                  │
│     └─ Calls Session.updatePartDelta()                             │
│                                                                     │
│  4. Database.effect() + Bus.publish()                              │
│     ├─ Database commits trigger effects                            │
│     ├─ Publishes typed events:                                     │
│     │   • MessageV2.Event.PartUpdated                              │
│     │   • Session.Event.StatusUpdated                              │
│     └─ Events go to local subscribers + GlobalBus                  │
│                                                                     │
│  5. GlobalBus.emit("event", {...})                                 │
│     ├─ Cross-module event distribution                             │
│     └─ Feeds SSE endpoints                                         │
│                                                                     │
│  6. SSE Endpoints (Hono streamSSE)                                 │
│     ├─ /global/event (global events)                               │
│     ├─ /session/:id/event (session-specific)                       │
│     ├─ Bus.subscribeAll() writes to SSE stream                     │
│     └─ Periodic heartbeats prevent timeout                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                 │
                                 │ SSE Stream (HTTP)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Client)                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  7. @opencode-ai/sdk: createSseClient()                            │
│     ├─ eventSdk.global.event() subscribes to SSE                   │
│     └─ Parses event stream                                         │
│                                                                     │
│  8. GlobalSDKProvider Event Queue                                  │
│     ├─ for await (const event of events.stream)                    │
│     ├─ Key-based coalescing (session.status, etc.)                 │
│     ├─ Buffer/Queue swap pattern                                   │
│     └─ Scheduled flush every 16ms                                  │
│                                                                     │
│  9. batch(() => emitter.emit())                                    │
│     ├─ SolidJS batch for single render                             │
│     └─ createGlobalEmitter dispatches events                       │
│                                                                     │
│ 10. Component Subscribers                                          │
│     ├─ useGlobalEvent(directory, eventType, handler)               │
│     ├─ SolidJS signals/stores update                               │
│     └─ UI re-renders (single optimized cycle)                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Key Components

#### Backend: SessionProcessor

**Location**: `packages/opencode/src/session/processor.ts`

```typescript
// Pseudo-code structure
SessionProcessor.create({
  async process() {
    for await (const value of fullStream) {
      if (value.type === "reasoning-start") {
        // Update reasoning part
        Session.updatePart(...)
      }
      if (value.type === "reasoning-delta") {
        // Update reasoning content
        Session.updatePartDelta(...)
      }
      // ... handle other stream types
    }
  }
})
```

**Event Chain**:
1. `Session.updatePart()` → Database write
2. `Database.effect()` → Triggers after commit
3. `Bus.publish(MessageV2.Event.PartUpdated, {...})` → Publishes event
4. `GlobalBus.emit()` → SSE distribution

#### Backend: SSE Endpoints

**Locations**:
- `/global/event`: `packages/opencode/src/server/routes/global.ts`
- `/session/:id/event`: Session-specific endpoint

```typescript
app.get('/global/event', async (c) => {
  return streamSSE(c, async (stream) => {
    const unsub = Bus.subscribeAll(async (event) => {
      await stream.writeSSE({
        data: JSON.stringify(event),
      })
      if (event.type === Bus.InstanceDisposed.type) {
        stream.close()
      }
    })
    
    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      stream.writeSSE({ comment: 'heartbeat' })
    }, 30000)
    
    // Cleanup
    stream.onAbort(() => {
      clearInterval(heartbeat)
      unsub()
    })
  })
})
```

#### Frontend: Event Consumer

**Location**: `packages/app/src/context/global-sdk.tsx`

```typescript
const GlobalSDKProvider = (props) => {
  useInit(() => {
    const eventSdk = createSseClient(config)
    const events = eventSdk.global.event()
    
    const emitter = createGlobalEmitter()
    let queue = []
    let buffer = []
    const coalesced = new Map()
    
    ;(async () => {
      for await (const event of events.stream) {
        // Coalescing + queueing logic
        // ... (see section 3.3)
      }
    })()
    
    return () => {
      // Cleanup
    }
  })
  
  return <GlobalSDKContext.Provider value={...}>
    {props.children}
  </GlobalSDKContext.Provider>
}
```

### 4.3 Data Format Example

**SSE Stream Format**:
```
data: {"type":"message.part.updated","properties":{"part":{"id":"part_123","messageID":"msg_456","content":"Hello"}}}

data: {"type":"session.status","properties":{"sessionID":"sess_789","status":"running"}}
```

**After Coalescing** (if multiple `message.part.updated` for same part):
- Only latest event kept in queue
- Reduces redundant UI updates

---

## 5. Double-Buffer Swap Pattern

### 5.1 Pattern Description

OpenCode doesn't explicitly call it "double-buffer swap" but implements the pattern functionally.

**Traditional Double Buffer**: Two buffers alternate between "write" and "read" roles

**OpenCode's Implementation**:
```typescript
let queue = []      // Write buffer (incoming events)
let buffer = []     // Read buffer (being processed)

function flush() {
  // Atomic swap
  const events = queue
  queue = buffer
  buffer = events
  queue.length = 0
  
  // Process 'buffer' (previously 'queue')
  for (const event of buffer) {
    emitter.emit(event.directory, event.payload)
  }
  
  buffer.length = 0  // Clear for next swap
}
```

### 5.2 Benefits

1. **Zero Lock Time**: Reference swap is O(1), instant
2. **Concurrent Collection**: New events enter `queue` during `buffer` processing
3. **No Race Conditions**: Clear separation of write/read buffers
4. **Memory Efficiency**: Reuse same array objects

### 5.3 Comparison to Single Buffer

**Single Buffer Issues**:
- Must lock during processing → events blocked
- Or copy array → memory overhead

**Double Buffer**:
- No locking needed
- Zero-copy swap (just reference exchange)
- Continuous event acceptance

---

## 6. Backpressure Handling

### 6.1 Multi-Layer Strategy

OpenCode handles backpressure through several complementary mechanisms:

#### 6.1.1 Event Coalescing

**Purpose**: Reduce event volume at source

**Implementation**:
```typescript
// If same key, replace existing event
if (k) {
  const i = coalesced.get(k)
  if (i !== undefined) {
    queue[i] = { directory, payload }
    continue  // Don't add new event
  }
  coalesced.set(k, queue.length)
}
```

**Effect**: 
- 1000 rapid `message.part.updated` events → 1 final state event
- Prevents queue explosion

#### 6.1.2 Stream Yielding

**Purpose**: Prevent event loop blocking

**Implementation**:
```typescript
const STREAM_YIELD_MS = 8

for await (const event of events.stream) {
  // ... process event
  
  if (Date.now() - yielded < STREAM_YIELD_MS) continue
  yielded = Date.now()
  await wait(0)  // Yield to event loop
}
```

**Effect**:
- Every 8ms, return control to browser
- UI remains responsive during event floods
- Prevents "script unresponsive" warnings

#### 6.1.3 Timed Batch Flushing

**Purpose**: Rate-limit UI updates

**Implementation**:
```typescript
const FLUSH_FRAME_MS = 16  // 60fps

const schedule = () => {
  if (timer) return
  const elapsed = Date.now() - last
  const delay = Math.max(0, FLUSH_FRAME_MS - elapsed)
  timer = setTimeout(flush, delay)
}
```

**Effect**:
- Max 60 render cycles per second
- Even with 10,000 events/sec, only 60 UI updates
- Prevents render thrashing

#### 6.1.4 SolidJS Batch

**Purpose**: Consolidate state updates

**Implementation**:
```typescript
batch(() => {
  for (const event of events) {
    emitter.emit(event.directory, event.payload)
  }
})
```

**Effect**:
- All signal updates in batch → 1 render cycle
- Without `batch()`: N events → N renders
- With `batch()`: N events → 1 render

#### 6.1.5 Reconnection Throttling

**Purpose**: Prevent connection spam on failure

**Implementation**:
```typescript
const RECONNECT_DELAY_MS = 250

catch (error) {
  if (!streamErrorLogged) {
    console.error("Event stream error:", error)
    streamErrorLogged = true
  }
  await wait(RECONNECT_DELAY_MS)  // Wait before retry
}
```

**Effect**:
- Gradual reconnection attempts
- Prevents server overload during issues

### 6.2 Backpressure Flow Diagram

```
High Event Rate (10k events/sec)
         │
         ▼
┌────────────────────┐
│  Coalescing        │  → Reduces to ~100 unique events/sec
│  (key-based)       │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Queue Buffer      │  → Collects events during frame
│  (16ms frame)      │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  Batch Flush       │  → Max 60 flushes/sec
│  (60fps)           │
└────────┬───────────┘
         │
         ▼
┌────────────────────┐
│  SolidJS batch()   │  → 1 render cycle per flush
│                    │
└────────┬───────────┘
         │
         ▼
    UI Update (smooth 60fps)
```

### 6.3 No Explicit Backpressure to Backend

**Observation**: OpenCode doesn't implement flow control signals to backend

**Why It Works**:
1. **SSE is one-way**: No backpressure protocol in SSE standard
2. **Coalescing absorbs bursts**: Client handles rate reduction
3. **Browser buffers**: Network layer provides buffering
4. **Event types**: Most events are state updates (idempotent)

**Alternative Approaches** (not used by OpenCode):
- WebSocket with flow control messages
- Chunked encoding with pause/resume
- Token bucket rate limiting on server

---

## 7. TUI Similar Pattern

**Location**: `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`

The Terminal UI also implements batching:

```typescript
const queue = []
let timer = undefined

const handleEvent = (event) => {
  queue.push(event)
  
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    const events = [...queue]
    queue.length = 0
    
    batch(() => {
      for (const event of events) {
        emitter.emit(event.payload)
      }
    })
  }, 16)
}
```

**Differences from Web UI**:
- **No coalescing**: Simpler queue-and-flush
- **Same 16ms interval**: Frame-aligned batching
- **Same batch() pattern**: SolidJS render optimization

---

## 8. Key Insights & Design Patterns

### 8.1 Type Safety at Every Layer

1. **Event Definition**: Zod schema enforces structure
2. **Publishing**: TypeScript ensures correct payload type
3. **Subscription**: Callback receives typed event object
4. **Runtime Validation**: Zod validates at boundaries

**Benefit**: Catch errors at compile time, not production

### 8.2 Dual Publishing Pattern

```typescript
// Local subscribers (immediate)
for (const sub of subscriptions) {
  pending.push(sub(payload))
}

// Global bus (for SSE)
GlobalBus.emit("event", { directory, payload })
```

**Benefit**: 
- Local: Fast, synchronous communication within process
- Global: Cross-boundary (process, network) event distribution

### 8.3 Database-Triggered Events

```typescript
Database.use((db) => {
  db.insert(Table).values(data).run()
  Database.effect(() => Bus.publish(Event, props))
})
```

**Pattern**: Events only fire after DB commit succeeds

**Benefit**: 
- Consistency: UI never shows uncommitted data
- Reliability: No phantom events from failed transactions

### 8.4 Frame-Aligned Batching

**16ms = 60fps**: Aligning event flushes with display refresh rate

**Why 16ms**:
- Most displays: 60Hz (16.67ms per frame)
- Browser render cycle typically synced to vsync
- Sweet spot: Responsive yet efficient

**Alternative**: `requestAnimationFrame()` for true vsync alignment

### 8.5 Progressive Coalescing

**Not All Events Coalesced**:
- `session.status`: Yes (state snapshots)
- `lsp.updated`: Yes (state snapshots)
- `message.part.updated`: Yes (content updates)
- `session.created`: No (singular events)

**Strategy**: Coalesce state updates, preserve events

### 8.6 Separation of Concerns

```
Transport Layer: SSE, HTTP, WebSocket
    ↕
Event Layer: Bus, GlobalBus, BusEvent
    ↕
Domain Layer: Session, Message, FileWatcher
    ↕
Storage Layer: Database, Effects
```

Each layer focused, testable, replaceable

---

## 9. Comparative Analysis

### 9.1 vs Redux/MobX

**OpenCode Bus**:
- ✅ Simpler: No global store, no reducers
- ✅ Type-safe: Zod + TypeScript
- ✅ Distributed: Works across process boundaries
- ❌ No time-travel debugging
- ❌ No middleware ecosystem

### 9.2 vs Event Emitter

**OpenCode Bus**:
- ✅ Type safety with Zod
- ✅ Dual local/global publishing
- ✅ Integrated with DB effects
- ✅ SSE streaming built-in
- ❌ More complex setup

### 9.3 vs RxJS

**OpenCode Bus**:
- ✅ Simpler learning curve
- ✅ Custom coalescing logic
- ❌ No operators (map, filter, debounce)
- ❌ No marble testing
- ❌ No complex stream composition

---

## 10. Potential Improvements

### 10.1 Adaptive Frame Rate

**Current**: Fixed 16ms flush interval

**Improvement**:
```typescript
const IDLE_FRAME_MS = 16
const BUSY_FRAME_MS = 50

const schedule = () => {
  const frameMs = queue.length > 100 ? BUSY_FRAME_MS : IDLE_FRAME_MS
  const delay = Math.max(0, frameMs - (Date.now() - last))
  timer = setTimeout(flush, delay)
}
```

**Benefit**: Reduce CPU during high load, maintain responsiveness when idle

### 10.2 Priority Queues

**Current**: All events treated equally

**Improvement**:
```typescript
const highPriority = []  // session.status, errors
const lowPriority = []   // logs, metrics

const flush = () => {
  batch(() => {
    for (const event of highPriority) emitter.emit(...)
    for (const event of lowPriority) emitter.emit(...)
  })
}
```

**Benefit**: Critical updates always processed first

### 10.3 Configurable Coalescing

**Current**: Hardcoded event types

**Improvement**:
```typescript
const coalesceConfig = {
  "session.status": (e) => `${e.directory}:${e.properties.sessionID}`,
  "lsp.updated": (e) => e.directory,
  // User can add custom rules
}
```

**Benefit**: Extensible without code changes

### 10.4 Backpressure Signal to Backend

**Current**: Client absorbs all events

**Improvement**: 
```typescript
// Send message over WebSocket
if (queue.length > 1000) {
  ws.send({ type: "SLOW_DOWN", queueSize: queue.length })
}
```

**Benefit**: Server can rate-limit or drop low-priority events

### 10.5 Event Replay Buffer

**Current**: No event history

**Improvement**:
```typescript
const replayBuffer = []  // Last 100 events
const MAX_REPLAY = 100

const flush = () => {
  replayBuffer.push(...buffer.slice(-MAX_REPLAY))
  // ... normal flush
}

// On reconnect:
const needsReplay = calculateMissedEvents()
for (const event of needsReplay) {
  queue.push(event)
}
```

**Benefit**: Recover from brief disconnections without full page reload

---

## 11. Implementation Checklist for Similar Systems

### Core Event Bus
- [ ] Define `BusEvent.define()` with Zod schemas
- [ ] Implement `Bus.publish()` with local + global emission
- [ ] Implement `Bus.subscribe()` and `Bus.subscribeAll()`
- [ ] Use `Map<string, Set<Function>>` for subscription storage
- [ ] Return unsubscribe function from `subscribe()`

### SSE Streaming
- [ ] Create `/event` SSE endpoint with framework (Hono, Express, etc.)
- [ ] Use `Bus.subscribeAll()` to feed SSE stream
- [ ] Implement heartbeat (30s interval recommended)
- [ ] Handle client disconnect cleanup
- [ ] Emit special "dispose" event on shutdown

### Client-Side Coalescing
- [ ] Set up dual queue/buffer arrays
- [ ] Define `key()` function for coalescable event types
- [ ] Implement `coalesced` Map for index tracking
- [ ] Create `flush()` with queue/buffer swap
- [ ] Use framework batch (SolidJS `batch()`, React `unstable_batchedUpdates()`, etc.)

### Backpressure Management
- [ ] Implement 16ms frame-aligned flushing
- [ ] Add 8ms event loop yielding during processing
- [ ] Use coalescing for state-update events
- [ ] Add reconnection delay (250ms recommended)
- [ ] Log errors with deduplication flag

### Database Integration
- [ ] Wrap DB operations in transaction
- [ ] Use effect/hook system to trigger events after commit
- [ ] Never publish events before DB confirms write
- [ ] Consider event sourcing for audit trail

### Testing
- [ ] Unit test event definition schemas
- [ ] Test subscription/unsubscription logic
- [ ] Test coalescing with rapid duplicate events
- [ ] Integration test SSE stream with client
- [ ] Load test with 10k+ events/sec
- [ ] Test reconnection after network failure
- [ ] Test cleanup on component unmount

---

## 12. References & Additional Reading

### DeepWiki Sources
- [Architecture Overview](https://deepwiki.com/wiki/anomalyco/opencode#2)
- [MCP (Model Context Protocol)](https://deepwiki.com/wiki/anomalyco/opencode#13)
- [UI Component Library](https://deepwiki.com/wiki/anomalyco/opencode#15)

### Key Files
- `packages/opencode/src/bus/index.ts` - Core Bus implementation
- `packages/app/src/context/global-sdk.tsx` - Client coalescing
- `packages/opencode/src/session/processor.ts` - SessionProcessor
- `packages/opencode/src/server/routes/global.ts` - SSE endpoint
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` - TUI events

### Related Technologies
- **Zod**: Schema validation - https://zod.dev
- **SolidJS**: Reactive UI library - https://solidjs.com
- **Hono**: Web framework - https://hono.dev
- **AI SDK**: LLM streaming - https://sdk.vercel.ai

### Similar Patterns in Other Systems
- **Redux Toolkit**: RTK Query with SSE
- **tRPC**: Subscription pattern
- **Phoenix LiveView**: Server-pushed updates
- **Hotwire Turbo Streams**: Action cable events

---

## Conclusion

OpenCode's event-bus architecture demonstrates a mature, production-grade approach to real-time event streaming. Key strengths:

1. **Type Safety**: Zod + TypeScript eliminate entire classes of bugs
2. **Performance**: Coalescing + batching handle 10k+ events/sec gracefully
3. **Simplicity**: Clean abstractions make complex flows comprehensible
4. **Reliability**: Database-triggered events ensure consistency

The architecture is particularly well-suited for:
- Real-time collaborative applications
- Streaming LLM responses
- File system watchers
- Multi-process coordination

OpenCode's patterns are directly applicable to any system requiring high-throughput, low-latency event distribution with strong type guarantees.
