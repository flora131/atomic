# OpenCode Hook Test Results - 2026-01-24

## Test Setup

1. Added `chat.message` hook to telemetry plugin with debug logging
2. Rebuilt plugin: `.opencode/plugin/dist/telemetry.js`
3. Ran test: `opencode` (direct invocation)
4. Typed: `/explain-code`

## Critical Findings

### Finding 1: The `chat.message` Hook WORKS for Direct OpenCode Usage

**Evidence from logs:**
```
[2026-01-24T17:40:32.313Z] chat.message hook fired: {
  "input": {
    "sessionID": "ses_40ee82056ffecgPsP54ZDZl5w1",
    "agent": "build",
    "model": {"providerID": "anthropic", "modelID": "claude-sonnet-4-5-20250929"}
  },
  "outputPartsCount": 1,
  "firstPartType": "text",
  "firstPartText": "/explain-code\n",  ← ORIGINAL SLASH COMMAND!
  "allPartTypes": ["text"]
}
```

**Stored message part:**
```json
{
  "type": "text",
  "text": "/explain-code\n"  ← STAYS AS ORIGINAL
}
```

✅ **Conclusion**: When typing slash commands directly in OpenCode, the `chat.message` hook receives the original command text.

### Finding 2: Different Behavior for `atomic -a opencode`

**Earlier session from `atomic -a opencode` with `/implement-feature`:**

**Stored message part:**
```json
{
  "type": "text",
  "text": "You are tasked with implementing a SINGLE feature from the `research/feature-list.json` file.\n\n# Getting up to speed\n\n1. Run `pwd`..."  ← ALREADY EXPANDED!
}
```

❌ **Conclusion**: When invoked via `atomic -a opencode`, the slash command is ALREADY EXPANDED by Atomic before it reaches OpenCode.

### Finding 3: Event Detection Also Works

The `message.part.updated` event also received the original text:

```
[2026-01-24T17:40:32.316Z] Event received: {
  "type": "message.part.updated",
  "properties": {
    "part": {
      "messageID": "msg_bf117dfb3001u3TW3eXXz9dqGR",
      "type": "text",
      "text": "/explain-code\n"  ← ORIGINAL COMMAND
    }
  }
}
```

## Architecture Analysis

### Direct OpenCode Usage Flow

```
User types: "/explain-code"
    ↓
OpenCode receives: "/explain-code"
    ↓
chat.message hook sees: "/explain-code\n" ✅
    ↓
message.part.updated event: "/explain-code\n" ✅
    ↓
Stored in DB: "/explain-code\n" ✅
    ↓
OpenCode reads: .opencode/command/explain-code.md
    ↓
OpenCode creates assistant message with expanded instructions
```

### `atomic -a opencode` Usage Flow

```
User runs: atomic -a opencode
    ↓
Atomic reads: .opencode/command/implement-feature.md (or other command)
    ↓
Atomic expands: Replaces frontmatter with content
    ↓
Atomic sends to OpenCode: "You are tasked with implementing..."
    ↓
chat.message hook sees: "You are tasked with..." ❌ (no "/implement-feature")
    ↓
message.part.updated event: "You are tasked with..." ❌
    ↓
Stored in DB: "You are tasked with..." ❌
```

## Why Original Detection Failed

When we tested `atomic -a opencode` with `/implement-feature`:
1. Atomic expanded the command before sending to OpenCode
2. OpenCode never saw the string "/implement-feature"
3. Our plugin couldn't detect it
4. Only detected "/commit" when the agent used that command in its response

## Solution: Hook-Based Detection WORKS (with caveat)

**For Direct OpenCode Usage:**
```typescript
export const TelemetryPlugin: Plugin = async ({ directory, client }) => {
  return {
    "chat.message": async (input, output) => {
      for (const part of output.parts) {
        if (part.type === "text") {
          const commands = extractCommands(part.text)
          sessionCommands.push(...commands)
        }
      }
    }
  }
}
```

✅ **This works perfectly for direct OpenCode invocation**

**For `atomic -a opencode` Usage:**
❌ **This won't work** - Atomic expands commands before OpenCode sees them

## Implications

### What We CAN Track

1. **Direct OpenCode usage**:
   - User types `/explain-code` in OpenCode UI
   - Hook detects: "/explain-code" ✅

2. **Commands invoked by agents**:
   - Agent uses `/commit` in its response
   - Hook detects: "/commit" ✅

### What We CANNOT Track (Currently)

1. **Initial `atomic -a opencode` command**:
   - User runs: `atomic -a opencode /implement-feature`
   - OpenCode receives: expanded instructions
   - Hook sees: no slash command ❌

## Recommendations

### Option 1: Hybrid Approach (Recommended)

**For OpenCode sessions:**
- Use `chat.message` hook to detect slash commands
- Works for direct usage and agent-invoked commands

**For Atomic sessions:**
- Track at the Atomic level (already implemented)
- atomic/src/index.ts already knows which command was run
- Keep existing telemetry in atomic binary

### Option 2: Track OpenCode Usage Generically

Don't try to distinguish commands in OpenCode:
```json
{
  "eventType": "agent_session",
  "agentType": "opencode",
  "commands": ["opencode-session"],
  "commandCount": 1
}
```

### Option 3: Parse Command Descriptions (Complex)

Match message content against known command descriptions:
- "You are tasked with implementing" → /implement-feature
- Fragile, requires maintaining mappings
- Not recommended

## Next Steps

1. **Implement hook-based detection** in the telemetry plugin
2. **Test with direct OpenCode usage** to verify it works
3. **Accept limitation** for `atomic -a opencode` (track at Atomic level instead)
4. **Document the architecture** for future reference

## Files Modified

- `.opencode/plugin/telemetry.ts` - Added chat.message hook with debug logging
- `.opencode/plugin/dist/telemetry.js` - Rebuilt plugin

## Test Evidence

- Plugin init log: `~/.local/share/atomic/opencode-plugin-init.log`
- Debug log: `~/.local/share/atomic/opencode-telemetry-debug.log` (64KB, all events captured)
- Session storage: `~/.local/share/opencode/storage/session/f93d6d6a0872589e3143c7836ded3e8a7d0693b4/ses_40ee82056ffecgPsP54ZDZl5w1.json`
