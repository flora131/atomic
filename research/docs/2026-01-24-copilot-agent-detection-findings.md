# GitHub Copilot Agent Detection - Investigation Findings

**Date:** January 24, 2026
**Investigation:** How to detect which agent was invoked across all 3 invocation methods

## Executive Summary

After thoroughly examining GitHub Copilot session files, logs, and events, I've identified **consistent patterns for detecting agent invocations** across all three methods. The most reliable approach is to examine the `events.jsonl` file within each session's directory.

---

## Key Finding: Agent Detection Location

**Primary Source:** `~/.copilot/session-state/<session-id>/events.jsonl`

This file contains a complete event log for each Copilot session, including agent invocations.

---

## Agent Detection Patterns by Invocation Method

### 1. Dropdown Invocation (UI: Type `/agent` → Select from dropdown)

**Detection Pattern:**
- Look for `user.message` event where `transformedContent` contains `<agent_instructions>` tags
- The agent instructions are injected into the prompt but **no explicit agent name** is present
- Need to parse the instruction content to infer the agent type

**Example from events.jsonl:**
```json
{
  "type": "user.message",
  "data": {
    "content": "explain the code",
    "transformedContent": "<agent_instructions>\n# Analyze and Explain Code Functionality\n...",
    "attachments": []
  }
}
```

**Session:** `d805b641-3ce2-4406-99c0-8eeb674a2359`
**Location:** Line 3 of events.jsonl

---

### 2. Natural Language with Explicit Agent Name

**Detection Pattern:**
- Look for `assistant.message` event with a `task` tool call
- The `toolRequests` array contains: `"agent_type": "<agent-name>"`
- This is the **most explicit and reliable** detection method

**Example from events.jsonl:**
```json
{
  "type": "assistant.message",
  "data": {
    "toolRequests": [
      {
        "toolCallId": "toolu_014kDLudm4B4uep4zHoUaPTa",
        "name": "task",
        "arguments": {
          "agent_type": "explain-code",
          "description": "Provide repo overview",
          "prompt": "Analyze the repository..."
        },
        "type": "function"
      }
    ]
  }
}
```

**User input:**
```json
{
  "type": "user.message",
  "data": {
    "content": "use explain-code to provide a two sentence overview of the repo"
  }
}
```

**Session:** `520b0844-b6cb-42bf-a6b3-8f5e4b430323`
**Location:** Lines 2, 4-6 of events.jsonl

---

### 3. CLI Command (`copilot --agent=<agent-name> --prompt "<task>"`)

**Status:** ✅ **TESTED** - Session: `bbe55f8e-5d8f-4be3-b5f9-e08be5e53ff9`

**Test Command:**
```bash
copilot --agent=explain-code --prompt "Explain the authentication flow"
```

**Detection Pattern:** ❌ **No Explicit Agent Name Recorded**

**Example from events.jsonl:**
```json
{
  "type": "user.message",
  "data": {
    "content": "Explain the authentication flow",
    "transformedContent": "<agent_instructions>\n# Analyze and Explain Code Functionality\n..."
  }
}
```

**Critical Finding:**
- The CLI method does **NOT** create an explicit `agent_type` field
- It follows the **same pattern as Method 1 (dropdown)**: agent instructions are injected into `transformedContent`
- The agent name "explain-code" is **NOT preserved** in the events
- You must parse the instruction header to infer which agent was used

**Session:** `bbe55f8e-5d8f-4be3-b5f9-e08be5e53ff9`
**Location:** Line 3 of events.jsonl

---

## Consistent Detection Strategy

### Approach: Parse events.jsonl in Order

```python
import json
from pathlib import Path

def detect_agent(session_id: str) -> str | None:
    """
    Detect which agent was invoked in a Copilot session.

    Returns: Agent name or None if no agent detected
    """
    events_file = Path.home() / ".copilot" / "session-state" / session_id / "events.jsonl"

    with open(events_file) as f:
        for line in f:
            event = json.loads(line.strip())

            # Method 1: Check for explicit task tool call (MOST RELIABLE)
            if event.get("type") == "assistant.message":
                tool_requests = event.get("data", {}).get("toolRequests", [])
                for tool in tool_requests:
                    if tool.get("name") == "task":
                        args = tool.get("arguments", {})
                        if "agent_type" in args:
                            return args["agent_type"]

            # Method 2: Check for transformed content with agent instructions
            if event.get("type") == "user.message":
                transformed = event.get("data", {}).get("transformedContent", "")
                if "<agent_instructions>" in transformed:
                    # Parse instructions to infer agent type
                    if "Analyze and Explain Code Functionality" in transformed:
                        return "explain-code"
                    # Add more patterns as needed

    return None
```

---

## File Structure for Reference

### Session Directory Contents
```
~/.copilot/session-state/<session-id>/
├── events.jsonl           # ✅ Primary source for agent detection
├── workspace.yaml         # Contains session metadata but NOT agent info
└── checkpoints/index.md   # Session checkpoints
```

### events.jsonl Event Types (Relevant)
- `session.start` - Session initialization (contains copilotVersion, cwd, git context)
- `user.message` - User input (contains `content` and `transformedContent`)
- `assistant.message` - Agent response (contains `toolRequests` with `agent_type`)
- `tool.execution_start` - Tool call begins
- `tool.execution_complete` - Tool call finishes (contains `toolTelemetry` with `agent_name`)

---

## Additional Metadata Sources

### Tool Execution Telemetry
When an agent completes execution, the `tool.execution_complete` event contains:

```json
{
  "type": "tool.execution_complete",
  "data": {
    "toolTelemetry": {
      "properties": {
        "agent_name": "explain-code",
        "agent_type": "custom-agent",
        "execution_mode": "sync",
        "prompt_length": "536"
      }
    }
  }
}
```

**Session examples:**
- `14c1620b-0076-4357-8c60-2a9ce7567b15` - Line 20, 25 (implement-feature agent)
- `54a314b6-af65-4d1a-af42-6d663a5e1fb4` - Line 191 (general-purpose agent)

---

## Command History

The file `~/.copilot/command-history-state.json` contains recent user inputs:

```json
{
  "commandHistory": [
    "explain the code",
    "/agent",
    "use explain-code to provide a two sentence overview of the repo",
    ...
  ]
}
```

**Limitation:** This shows what the user typed but doesn't map to specific sessions or indicate which agent was actually invoked.

---

## Recommended Solution for Your Use Case

### For Real-Time Detection (during active session)
**Option 1: Hook into events.jsonl streaming**
- Monitor the active session's `events.jsonl` file
- Watch for `assistant.message` events with `task` tool calls
- Extract `agent_type` from tool arguments

**Option 2: Parse telemetry events**
- Wait for `tool.execution_complete` events
- Extract `agent_name` from `toolTelemetry.properties`

### For Historical Analysis (completed sessions)
```bash
# Find all agent invocations across all sessions
grep -h "agent_type\|agent_name" ~/.copilot/session-state/*/events.jsonl \
  | grep -o '"agent_[^"]*":"[^"]*"' \
  | sort | uniq -c
```

---

## Testing Requirements

### Immediate Next Steps
To complete this investigation, you need to test **CLI invocation** (#3):

1. **Test CLI with explicit agent:**
   ```bash
   copilot --agent=explain-code --prompt "What does this repository do?"
   ```

2. **Capture session ID:**
   ```bash
   # The session will be in the most recent directory
   ls -lt ~/.copilot/session-state/ | head -2
   ```

3. **Examine the events.jsonl:**
   ```bash
   cat ~/.copilot/session-state/<newest-session-id>/events.jsonl
   ```

4. **Look for:**
   - Any mention of "explain-code" in the events
   - CLI arguments in `session.start` or initial `user.message` events
   - `agent_type` in `task` tool calls

---

## Summary Table

| Invocation Method | Detection Method | Reliability | Location in events.jsonl |
|------------------|------------------|-------------|-------------------------|
| **Dropdown UI** | Parse `<agent_instructions>` in `transformedContent` | Medium (requires pattern matching) | `user.message` event |
| **Natural Language (explicit)** | Extract `agent_type` from `task` tool call | **High (explicit)** ✅ | `assistant.message` event → `toolRequests` |
| **CLI Command** | Parse `<agent_instructions>` in `transformedContent` | Medium (requires pattern matching) | `user.message` event |

**Key Insight:** Only natural language invocations with explicit agent names (e.g., "use explain-code to...") create a reliable `agent_type` record. Both dropdown and CLI methods require parsing instruction headers.

---

## Questions Answered

1. **Does the CLI method use the same `task` tool pattern?**
   - ❌ **NO** - CLI uses the same pattern as dropdown (agent instructions injected)

2. **Are CLI arguments preserved anywhere in session metadata?**
   - Checked: `session.start` - ❌ NO
   - Checked: `workspace.yaml` - ❌ NO
   - Checked: process logs - ❌ NO (only version info)
   - Checked: `events.jsonl` user.message - ❌ NO (only the prompt, not `--agent` flag)

3. **Is there a difference between `copilot --agent=X` and natural language "use X"?**
   - ✅ **YES** - Major difference:
     - CLI: No explicit agent name recorded
     - Natural language "use X to...": Explicit `agent_type` field created

---

## Conclusion

### **The ONLY reliable detection method is:**

✅ **Natural language with explicit agent reference** (e.g., "use explain-code to...")

This creates an `assistant.message` event with a `task` tool call containing the `agent_type` field.

### **For all other methods (dropdown, CLI):**

You **must** parse the `<agent_instructions>` header in the `transformedContent` field to infer which agent was used. This requires maintaining a mapping of instruction headers to agent names.

### **Recommended Detection Strategy:**

```python
def detect_agent(events_jsonl_path: str) -> str | None:
    """
    Detect agent from Copilot session events.

    Priority:
    1. Explicit agent_type from task tool call (natural language)
    2. Infer from instruction header (dropdown/CLI)
    """
    with open(events_jsonl_path) as f:
        for line in f:
            event = json.loads(line.strip())

            # Priority 1: Check for explicit task tool call
            if event.get("type") == "assistant.message":
                for tool in event.get("data", {}).get("toolRequests", []):
                    if tool.get("name") == "task":
                        agent_type = tool.get("arguments", {}).get("agent_type")
                        if agent_type:
                            return agent_type

            # Priority 2: Parse instruction header
            if event.get("type") == "user.message":
                transformed = event.get("data", {}).get("transformedContent", "")
                if "<agent_instructions>" in transformed:
                    return infer_agent_from_header(transformed)

    return None
```

**Investigation Complete:** All 3 methods tested and documented.
