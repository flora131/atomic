# OpenCode TUI Chat Implementation Research

**Date**: 2026-02-16  
**Repository**: anomalyco/opencode  
**Research Method**: DeepWiki AI-powered repository analysis

---

## Table of Contents

1. [Chat Message Rendering & Message Part/Segment Model](#1-chat-message-rendering--message-partsegment-model)
2. [Streaming Content Ordering](#2-streaming-content-ordering)
3. [Sub-Agent Lifecycle State Tracking](#3-sub-agent-lifecycle-state-tracking)
4. [Human-in-the-Loop Prompts (ask_question)](#4-human-in-the-loop-prompts-ask_question)
5. [Message State Management Architecture](#5-message-state-management-architecture)
6. [OpenTUI Chat Interface Layout](#6-opentui-chat-interface-layout)

---

## 1. Chat Message Rendering & Message Part/Segment Model

**DeepWiki Search**: https://deepwiki.com/search/how-does-the-opencode-tui-rend_a8b58b6c-c2fd-46d4-9948-7534018a58d6

### Overview

The OpenCode TUI renders chat messages by mapping different message "parts" to specific UI components. The core message model involves `MessageV2.Part` objects, which can represent various types of content like text, tool calls, and reasoning. These parts are then processed and displayed in the TUI, interleaving different content types to form a coherent conversation flow.

### Message Part/Segment Model

The fundamental unit for chat messages in OpenCode is the `MessageV2.Part`. These parts are stored and retrieved from `Storage` and are associated with a `MessageV2.Info` object that contains metadata like role and session ID.

**Different types of `MessageV2.Part` include:**

- **Text**: Represents plain text content
- **File**: Represents file attachments, with properties like `mime`, `filename`, and `url`
- **Tool**: Represents tool calls, including their status (`completed`, `error`, `pending`, `running`), input, output, and associated metadata
- **Reasoning**: Represents the AI's thought process or reasoning steps
- **Compaction**: Indicates a message compaction event
- **Subtask**: Represents a subtask executed by the user
- **Step-start**: Marks the beginning of a step in the AI's process

**Key Source Files:**

- `packages/opencode/src/session/message-v2.ts` - The `toModelMessages` function converts internal `WithParts` messages into a format suitable for the model, handling the transformation of different part types

### Rendering Chat Messages in the TUI

The OpenCode TUI uses a component-based approach to render chat messages. The `Session` component iterates through a list of messages and uses a `Switch` statement to determine how to render each message based on its type.

**Key Components:**

- **`Session` component** (`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`) - Main component that iterates through messages
- **`UserMessage` component** - Displays user messages with text and file parts. Extracts text and file parts from the message and renders them accordingly. File attachments are displayed with their MIME type and filename.
- **`AssistantMessage` component** - Iterates through the `parts` of an assistant message and dynamically renders them using a `PART_MAPPING`

### Interleaving Tool Calls, Sub-Agent Outputs, and Text

The interleaving of different content types is achieved through the `PART_MAPPING` object, which maps `part.type` to specific rendering components.

**Part-to-Component Mapping:**

- **Text**: 
  - Component: `TextPart`
  - Implementation: `TextPartDisplay` function in `packages/ui/src/components/message-part.tsx`
  - Renders text content with Markdown formatting

- **Tool Calls**:
  - Component: `ToolPart`
  - Implementation: `ToolPartDisplay` function in `packages/ui/src/components/message-part.tsx`
  - Handles display of tool outputs, including error states and permission prompts
  - Specific tools like `bash`, `edit`, `read`, `list`, `glob`, `write`, and `task` have their own registered render functions within the `ToolRegistry`
  - Example: The `bash` tool displays the command and its output in a code block

- **Reasoning**:
  - Component: `ReasoningPart`
  - Implementation: `ReasoningPartDisplay` function in `packages/ui/src/components/message-part.tsx`
  - Renders reasoning text with Markdown support

- **Sub-agent Outputs**:
  - Handled through the `task` tool
  - The `task` tool's render function in `packages/ui/src/components/message-part.tsx` can display child session tool parts and handle permissions related to sub-agents

### Message Conversion

The `packages/opencode/src/session/message-v2.ts` file shows how different parts are converted into `UIMessage` objects, which are then used for rendering. This conversion process ensures that media attachments in tool results are handled correctly, potentially injecting them as separate user messages if the model doesn't support them directly.

### Additional References

- `packages/web/src/content/docs/tui.mdx` - User-facing documentation on TUI interaction, including referencing files with `@` and running bash commands with `!`
- `packages/web/src/components/share/part.tsx` - Rendering logic for message parts (web-based sharing component, not TUI)

**Wiki Pages:**
- [Client-Server Model (anomalyco/opencode)](/wiki/anomalyco/opencode#2.2)

---

## 2. Streaming Content Ordering

**DeepWiki Search**: https://deepwiki.com/search/how-does-opencodes-tui-handle_3266c1ed-be45-4370-a075-dcb59e4cf4ab

### Overview

OpenCode's TUI handles streaming content ordering by processing different types of message parts (reasoning, text, tool calls) and ensuring they are enqueued and displayed chronologically. This is primarily managed within the `OpenAICompatibleChatLanguageModel` which transforms incoming data chunks into a stream of `LanguageModelV2StreamPart` events.

### Content Ordering Mechanism

The `OpenAICompatibleChatLanguageModel` uses a `TransformStream` to process chunks of data from the language model and convert them into a structured stream of events. This stream ensures that different content types are ordered correctly:

**Event Types & Ordering:**

1. **Reasoning Parts**:
   - Indicated by `reasoning_text` in incoming data
   - Enqueued as `reasoning-start` and `reasoning-delta` events
   - If text content or tool calls begin while reasoning is active, a `reasoning-end` event is enqueued first to maintain chronological order

2. **Text Parts**:
   - Indicated by `delta.content`
   - Enqueued as `text-start` and `text-delta` events

3. **Tool Calls**:
   - When `delta.tool_calls` are present
   - Enqueued as `tool-input-start`, `tool-input-delta`, and `tool-input-end` events
   - A `tool-call` event is enqueued once the tool's arguments are parsable JSON

**Flush Mechanism:**
The `flush` method ensures that any active reasoning, text, or unfinished tool calls are properly ended when the stream concludes.

### TUI Interaction

The TUI, specifically the `Session` component, listens for `MessageV2.Event.PartUpdated` events to render content:

- When a `text` part is updated and its `time.end` property is set, the TUI renders the complete markdown text
- For `tool` parts that have completed, the TUI prints a formatted event indicating the tool and its title

### Interactive Prompts

The `Prompt` component handles user input and can update non-text parts (like file or agent references) based on their position within the edited content.

### Additional References

- `packages/opencode/src/server/routes/tui.ts` - Defines API endpoints for TUI control:
  - `/tui/control/next` - Retrieving TUI requests
  - `/tui/control/response` - Submitting TUI responses
- `packages/sdk/openapi.json` - Lists TUI control endpoints

**Note**: The endpoints exist but the TUI running in the same process as the CLI directly imports and interacts with session management for performance, bypassing the HTTP layer.

**Wiki Pages:**
- [Client-Server Model (anomalyco/opencode)](/wiki/anomalyco/opencode#2.2)
- [Core Runtime (anomalyco/opencode)](/wiki/anomalyco/opencode#3)

---

## 3. Sub-Agent Lifecycle State Tracking

**DeepWiki Search**: https://deepwiki.com/search/how-does-opencode-track-and-di_9a473cc4-a85b-4ed9-84c0-b21017fccb05

### Overview

OpenCode tracks and displays sub-agent lifecycle states through `ToolPart` objects, which contain a `ToolState` that transitions through `pending`, `running`, `completed`, and `error` states. These state transitions are driven by events during the agentic execution loop.

### Sub-Agent Lifecycle States

The core mechanism for tracking sub-agent states is the `ToolPart` type, which is part of a `MessageV2`. Each `ToolPart` has a `state` property of type `ToolState`, which can be:

1. **`ToolStatePending`**: The tool has been requested by the LLM but has not yet started execution
2. **`ToolStateRunning`**: The tool is currently executing
3. **`ToolStateCompleted`**: The tool has finished execution successfully
4. **`ToolStateError`**: The tool encountered an error during execution

**Additional Properties:**
The `ToolPart` also includes `id`, `sessionID`, `messageID`, `callID`, and `tool` properties to identify the specific tool call and its context.

### State Transitions and Driving Events

State transitions are managed within the `SessionPrompt.loop()` and `Session.updatePart()` functions.

**State Transition Flow:**

1. **Pending → Running**:
   - **Trigger**: LLM requests a tool during `tool-input-start` event
   - **Action**: `ToolPart` created with status `pending` in the `create` function of session processor
   - **Next**: `tool-call` event triggers transition to `running` via `Session.updatePart`

2. **Running → Completed**:
   - **Trigger**: Tool execution finishes successfully during `tool-result` event
   - **Action**: `ToolPart` status updated to `completed`, includes `output` and `time.end`

3. **Running → Error**:
   - **Trigger**: Tool execution fails during `tool-error` event
   - **Action**: `ToolPart` status set to `error` with error message recorded

4. **Interrupted State**:
   - Not an explicit `ToolState` enum value
   - Handled by converting `pending` or `running` tool calls to `error` state with message: `"[Tool execution was interrupted]"`
   - Ensures dangling tool calls are properly accounted for when converting messages for the model

### Display in TUI

The TUI displays these states using components:

- **`BlockTool` and `InlineTool`** - Base tool display components
- **`Bash` component** - Checks `props.part.state.status === "running"` to display spinner
- **`Task` component** - Uses `props.part.state.status === "running"` to show spinner for sub-agent tasks
  - The `current()` memo tracks status of tools within a sub-agent session to display the latest tool's status and title

### CLI Integration

The `run` command subscribes to `message.part.updated` events to display tool execution information in the CLI, including:
- When a tool is `completed`
- When a `task` tool is `running`

### Agent Communication Protocol (ACP)

The ACP mirrors these states for external communication, sending updates for:
- `pending`
- `running`
- `completed`
- `failed` tool calls

**Wiki Pages:**
- [Core Runtime (anomalyco/opencode)](/wiki/anomalyco/opencode#3)

---

## 4. Human-in-the-Loop Prompts (ask_question)

**DeepWiki Search**: https://deepwiki.com/search/how-does-opencodes-tui-handle_42ee79b7-d83d-4528-ad48-6abc540a3812

### Overview

OpenCode's TUI handles "ask_question" or human-in-the-loop prompts by presenting them as interactive components within the chat stream, typically appearing below the streaming content and above the main prompt input area.

### Handling of `ask_question` Prompts

When the Language Model (LLM) needs to ask the user a question, it utilizes the `question` tool:

**Tool Implementation:**
- **Location**: `packages/opencode/src/tool/question.ts`
- **Method**: The `execute` method calls `Question.ask` to present questions to the user

**TUI Rendering:**
- **Component**: `QuestionPrompt` 
- **Responsibilities**:
  - Manages display of questions
  - Handles user input for answers
  - Navigation between multiple questions
  - Allows users to select from provided options or type custom answers
  - Handles keyboard events for navigation and submission
- **Submission**: Once user submits answers, `sdk.client.question.reply` method is called to send responses back

### Placement Relative to Streaming Content

**TUI Layout:**
- **Location**: `Session` component in `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`
- **Conditional Rendering**: Uses a `Show` condition to render `QuestionPrompt` when:
  - There are active questions
  - No pending permission requests exist
- **Position**: Placed directly above the `Prompt` input component, below the main message stream

**Web Application Layout:**
- **Component**: `SessionPromptDock` in `packages/app/src/pages/session/session-prompt-dock.tsx`
- **Renders**: `QuestionDock` components
- **Position**: Bottom of chat interface, above the prompt input

### API Endpoints

While API endpoints exist for TUI control:
- `/tui/control/next` - Retrieve next TUI request
- `/tui/control/response` - Submit a response

**Note**: The TUI running in the same process as the CLI directly imports and interacts with session management, bypassing the HTTP layer for performance. Direct rendering of `QuestionPrompt` components is the primary mechanism for handling human-in-the-loop questions.

**References:**
- `packages/sdk/openapi.json` - Defines API endpoints

**Wiki Pages:**
- [Client-Server Model (anomalyco/opencode)](/wiki/anomalyco/opencode#2.2)

---

## 5. Message State Management Architecture

**DeepWiki Search**: https://deepwiki.com/search/what-is-the-architecture-of-op_0fd18935-9fc6-4b96-a32d-104821550d97

### Overview

OpenCode's message state management is built around a client-server architecture where the core runtime manages sessions and messages, and client applications subscribe to events to update their UI. Message data flows from SDK events, which are processed by event reducers in the client, to update a local store that drives UI rendering.

### Architecture Components

**Core Runtime:**
- **Location**: `packages/opencode` directory, specifically the `session` module
- **Structure**: Messages structured with `Message` and `Part` types
  - `Message`: Represents conversations
  - `Part`: Represents constituent content
- **Session Management**: Handles creation, updating, and removal of messages and their parts
- **Event Propagation**: Operations trigger events propagated to connected clients

### Message Data Flow

The complete flow from SDK events to UI rendering:

**1. SDK Event Subscription**
- Client applications (e.g., TUI) subscribe to events from OpenCode server using SDK client
- Function: `createOpencodeClient` establishes connection to server's base URL
- Receives real-time events

**2. Event Handling and Batching**
- **Handler**: `handleEvent` function
- **Process**:
  - Queues incoming events
  - Batches updates to optimize UI rendering
  - Ensures multiple store updates result in single render cycle

**3. Local State Management**
- **Store**: Created using `createStore` from `solid-js/store`
- **Contents**: Application state including messages and parts
- **Pattern**: Immutable updates using `produce` from `solid-js/store`

**4. Event Reducers**
- **Function**: `applyDirectoryEvent` (or similar logic in `packages/opencode/src/cli/cmd/tui/context/sync.tsx`)
- **Process**:
  - Receives events like `message.updated` or `message.part.updated`
  - Uses `produce` to immutably update local store based on event properties
  - Example: `message.updated` event causes the `info` property to be reconciled and updated in the `message` section of store

**5. UI Rendering**
- Updated local store triggers re-renders in dependent UI components
- Example: `UserMessage` components observe changes in `props.message` and `props.parts` to display conversation

### Optimistic Updates

**Location**: `packages/app/src/context/sync.tsx`
- Contains `optimisticAdd` function for user messages
- User-initiated messages immediately reflected in UI before server confirmation
- Provides responsive user experience

**Note**: Primary flow for AI responses is through event-driven mechanism described above.

**Wiki Pages:**
- [Core Runtime (anomalyco/opencode)](/wiki/anomalyco/opencode#3)
- [Project and Workspace Management (anomalyco/opencode)](/wiki/anomalyco/opencode#9)

---

## 6. OpenTUI Chat Interface Layout

**DeepWiki Search**: https://deepwiki.com/search/how-does-opencode-use-opentui_d9ee99cf-4fb7-44d5-a24d-051515d8290d

### Overview

OpenCode utilizes OpenTUI, a **SolidJS-based framework** (not Ink/React), for its chat interface rendering. The core chat area, including scrolling and message display, is managed within the `Session` component.

**Technology Stack:**
- Framework: `@opentui/solid` with SolidJS
- **Not** Ink or React-based

### Chat Interface Layout

**Main Component**: `Session` component at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

**Layout Structure:**
- Uses `<box>` component for flexible layout
- Contains `<scrollbox>` for message history
- `Header` component displayed at top
- `Sidebar` can be toggled for additional information

### Scrollable Chat Area and Sticky Scrolling

**Component**: `<scrollbox>` from OpenTUI

**Configuration:**
```typescript
<scrollbox 
  stickyScroll={true} 
  stickyStart="bottom"
  scrollAcceleration={...}
>
```

**Behavior:**
- Viewport automatically snaps to bottom when new messages arrive
- **Unless** user has manually scrolled up
- `scrollAcceleration` property for smoother scrolling
- `scroll` reference used for programmatic control (e.g., scroll to bottom on new session load)

**Navigation Commands:**
Available for jumping between messages:
- `messages_next` - Next message
- `messages_previous` - Previous message
- `messages_last_user` - Last user message
- `messages_first` - First message (top)
- `messages_last` - Last message (bottom)

### Message Rendering

**Implementation within scrollbox:**

```typescript
<For each={messages()}>
  {(message) => (
    <Switch>
      <Match when={/* conditions */}>
        {/* Conditional rendering logic */}
      </Match>
    </Switch>
  )}
</For>
```

**Process:**
1. Messages rendered iteratively using `For` loop over `messages()` signal
2. Conditional rendering via `Switch` and `Match` statements
3. Different rendering logic based on message properties (e.g., reverted sequence status)

**Components:**
- `UserMessage` - Renders user prompts
- `AssistantMessage` - Renders AI responses

### Additional Implementations

While the query focused on TUI, similar concepts exist in other packages:

**Web Application:**
- `packages/app/src/pages/session.tsx` - Session rendering for web
- `packages/ui/src/components/session-turn.tsx` - Shared UI components

**Note**: These are distinct from the terminal-based OpenTUI implementation.

**Wiki Pages:**
- [Terminal User Interface (anomalyco/opencode)](/wiki/anomalyco/opencode#5)

---

## Summary of Key Findings

### Architecture Pattern
OpenCode uses a **client-server event-driven architecture** with:
- Core runtime managing sessions and messages
- Client applications subscribing to events
- Local state management with optimized batching
- Component-based UI rendering

### Message Model
- **Fundamental unit**: `MessageV2.Part`
- **Part types**: Text, File, Tool, Reasoning, Compaction, Subtask, Step-start
- **State tracking**: Through `ToolState` enum (pending, running, completed, error)
- **Interleaving**: Via `PART_MAPPING` object connecting parts to components

### Streaming Strategy
- `TransformStream` processes LLM output into structured events
- Event types: `reasoning-start/delta/end`, `text-start/delta`, `tool-input-start/delta/end`, `tool-call`
- Chronological ordering maintained through event sequencing
- Flush mechanism ensures proper stream termination

### User Interaction
- Human-in-the-loop via `QuestionPrompt` component
- Positioned between message stream and main input
- Handles multiple questions with navigation
- Direct method calls for optimal performance

### UI Framework
- **OpenTUI** with **SolidJS** (not Ink/React)
- `<scrollbox>` with sticky scrolling to bottom
- Programmatic navigation commands
- Component-based message rendering with `For` loops and conditional `Switch` statements

### Event Flow
```
SDK Events → Event Handler → Batching → Local Store → Event Reducers → UI Components
```

---

## Related Wiki Pages

- [Client-Server Model (anomalyco/opencode)](/wiki/anomalyco/opencode#2.2)
- [Core Runtime (anomalyco/opencode)](/wiki/anomalyco/opencode#3)
- [Terminal User Interface (anomalyco/opencode)](/wiki/anomalyco/opencode#5)
- [Project and Workspace Management (anomalyco/opencode)](/wiki/anomalyco/opencode#9)

---

## All DeepWiki Search Links

1. Message Rendering: https://deepwiki.com/search/how-does-the-opencode-tui-rend_a8b58b6c-c2fd-46d4-9948-7534018a58d6
2. Streaming Content: https://deepwiki.com/search/how-does-opencodes-tui-handle_3266c1ed-be45-4370-a075-dcb59e4cf4ab
3. Sub-Agent States: https://deepwiki.com/search/how-does-opencode-track-and-di_9a473cc4-a85b-4ed9-84c0-b21017fccb05
4. Human-in-the-Loop: https://deepwiki.com/search/how-does-opencodes-tui-handle_42ee79b7-d83d-4528-ad48-6abc540a3812
5. State Management: https://deepwiki.com/search/what-is-the-architecture-of-op_0fd18935-9fc6-4b96-a32d-104821550d97
6. OpenTUI Layout: https://deepwiki.com/search/how-does-opencode-use-opentui_d9ee99cf-4fb7-44d5-a24d-051515d8290d
