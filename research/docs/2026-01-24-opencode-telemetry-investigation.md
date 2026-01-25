# OpenCode Telemetry Investigation - 2026-01-24

## Problem Statement

When testing `atomic -a opencode` with `/implement-feature`, the telemetry system only detects `/commit` in the agent_session event, not `/implement-feature`.

## Root Cause Analysis

### OpenCode Slash Command Architecture

OpenCode slash commands work fundamentally differently than expected:

1. **User types**: `/implement-feature`
2. **OpenCode reads**: `.opencode/command/implement-feature.md`
3. **OpenCode extracts frontmatter**:
   ```yaml
   ---
   description: Implement a SINGLE feature...
   agent: build
   model: anthropic/claude-opus-4-5
   ---
   ```
4. **OpenCode creates message** with:
   - `message.agent = "build"` (from frontmatter)
   - `message.text = <markdown content>` (frontmatter removed)
5. **Slash command name is NEVER stored in the message**

### Agent Mapping Analysis

All Atomic slash commands map to `agent: build` except one:

```
cancel-ralph: agent: build
commit: agent: build
create-feature-list: agent: build
create-gh-pr: agent: build
create-spec: agent: build
explain-code: agent: build
implement-feature: agent: build  ← SAME AS COMMIT!
ralph-help: agent: build
ralph-loop: agent: ralph  ← Only different one
research-codebase: agent: build
```

**Conclusion**: Cannot distinguish between slash commands using the `agent` field.

### Why We Only Detected `/commit`

1. User runs `atomic -a opencode`
2. Atomic invokes OpenCode with `/implement-feature` prompt
3. OpenCode expands `/implement-feature` to its markdown content
4. Message stored with `agent: "build"`, text contains instructions (no "/implement-feature")
5. Implement-feature agent runs and uses `/commit` command
6. The text "/commit" appears in the assistant's message when invoking the command
7. Our telemetry scans message text and finds "/commit"
8. Result: Only `/commit` is detected, not `/implement-feature`

## Evidence

### Session Files Location
- **Session metadata**: `~/.local/share/opencode/storage/session/<project-id>/<session-id>.json`
- **Message metadata**: `~/.local/share/opencode/storage/message/<session-id>/<message-id>.json`
- **Message content**: `~/.local/share/opencode/storage/part/<message-id>/<part-id>.json`

### Example Message Structure

Message JSON (`msg_bf10b3a11001q1YJBhTqx1wTa3.json`):
```json
{
  "id": "msg_bf10b3a11001q1YJBhTqx1wTa3",
  "sessionID": "ses_40ef4c5f4ffehlkKVthZ5ev9Gh",
  "role": "user",
  "agent": "build",  ← Generic agent name, not slash command
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-opus-4-5"
  }
}
```

Part JSON (`prt_bf10b3a1b001EOvUQoWZkQJhca.json`):
```json
{
  "id": "prt_bf10b3a1b001EOvUQoWZkQJhca",
  "type": "text",
  "text": "You are tasked with implementing a SINGLE feature..."  ← Expanded instructions
}
```

**Note**: The text contains the full markdown content from `implement-feature.md` but does NOT contain the string "/implement-feature".

## Current Plugin Issues

### Issue 1: Plugin Not Loading

The telemetry plugin at `.opencode/plugin/telemetry.ts` is not being loaded:
- Debug logs show no initialization
- Module-level code doesn't execute
- Plugin configuration in `opencode.json` may be incorrect

### Issue 2: Event-Based Approach Won't Work

Even if the plugin loads, scanning `message.part.updated` events for slash commands is fundamentally flawed because:
- Slash command names are not in the message text
- All commands use the same `agent: build` value
- Cannot distinguish which slash command was used

## Solution Options

### Option 1: Hook-Based Detection (Recommended)

Use the `chat.message` hook to intercept the original user input BEFORE OpenCode transforms it:

```typescript
export const TelemetryPlugin: Plugin = async ({ directory, client }) => {
  return {
    "chat.message": async (input, output) => {
      // input/output contains the original user message before transformation
      for (const part of output.parts) {
        if (part.type === "text") {
          const commands = extractCommands(part.text)
          sessionCommands.push(...commands)
        }
      }
    },
  }
}
```

**Status**: Need to verify if `chat.message` hook receives original input or transformed content.

### Option 2: Command File Watching

Watch for reads of `.opencode/command/*.md` files to detect when commands are invoked:
- Requires file system watching
- May not work with OpenCode's caching
- Complex implementation

### Option 3: Parse Session Files After Completion

Read OpenCode session files after the session ends:
- Parse message metadata to find command descriptions
- Match descriptions against known commands
- Requires maintaining command description → name mapping

### Option 4: Track Only Agent Type, Not Commands

Simplify tracking to just record that OpenCode was used:
```json
{
  "eventType": "agent_session",
  "agentType": "opencode",
  "commands": ["opencode-session"],  ← Generic marker
  "commandCount": 1
}
```

**Pro**: Simple, reliable
**Con**: Loses granular command tracking

## Recommended Next Steps

1. **Research `chat.message` hook**: Determine if it receives original or transformed input
2. **Test hook-based approach**: If chat.message has original input, implement detection there
3. **If hooks don't work**: Consider Option 4 (track only that OpenCode was used)
4. **Fix plugin loading**: Resolve why the plugin isn't being loaded by OpenCode

## Open Questions

1. Does the `chat.message` hook receive the original user input (e.g., "/implement-feature") or the transformed content?
2. Are there other hooks or events that fire when slash commands are executed?
3. Is there a way to access the command name from the message metadata?
4. Should we track OpenCode usage without granular command tracking?

## Files Examined

- `/Users/norinlavaee/.local/share/opencode/storage/session/f93d6d6a0872589e3143c7836ded3e8a7d0693b4/ses_40ef4c5f4ffehlkKVthZ5ev9Gh.json`
- `/Users/norinlavaee/.local/share/opencode/storage/message/ses_40ef4c5f4ffehlkKVthZ5ev9Gh/msg_bf10b3a11001q1YJBhTqx1wTa3.json`
- `/Users/norinlavaee/.local/share/opencode/storage/part/msg_bf10b3a11001q1YJBhTqx1wTa3/prt_bf10b3a1b001EOvUQoWZkQJhca.json`
- `/Users/norinlavaee/atomic/.opencode/command/implement-feature.md`
- `/Users/norinlavaee/atomic/.opencode/command/commit.md`
