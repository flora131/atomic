# Create Debug Report

You are tasked with debugging and identifying errors, test failures, and unexpected behavior in the codebase. Your goal is to identify root causes and generate a report detailing the issues and proposed fixes.

When invoked:
1a. If the user doesn't provide specific error details output:
```
I'll help debug your current issue.

Please describe what's going wrong:
- What are you working on?
- What specific problem occurred?
- When did it last work?

Or, do you prefer I investigate by attempting to run the app or tests to observe the failure firsthand?
```
1b. If the user provides specific error details, proceed with debugging as described below.
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Create a detailed debugging report with findings and recommendations

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Suggested code fix with relevant file:line references
- Testing approach
- Prevention recommendations

Focus on documenting the underlying issue, not just symptoms.

Available Tools

Use the **Playwright MCP tools** to interact with web applications for debugging:
- `mcp__playwright__browser_navigate` - Navigate to URLs
- `mcp__playwright__browser_snapshot` - Capture accessibility snapshots (preferred over screenshots)
- `mcp__playwright__browser_take_screenshot` - Take screenshots when visual inspection is needed
- `mcp__playwright__browser_click` - Click on elements
- `mcp__playwright__browser_type` - Type text into elements
- `mcp__playwright__browser_console_messages` - Get console messages (errors, warnings, logs)
- `mcp__playwright__browser_network_requests` - View network requests
- `mcp__playwright__browser_evaluate` - Execute JavaScript in the browser
- `mcp__playwright__browser_wait_for` - Wait for text to appear/disappear
- `mcp__playwright__browser_close` - Close the browser when done

- Use Playwright tools to interact with and inspect the running application:
  - Use `mcp__playwright__browser_console_messages` to check for JavaScript errors
  - Use `mcp__playwright__browser_network_requests` to inspect API calls and responses
  - Use `mcp__playwright__browser_snapshot` to get the current page state
  - Use `mcp__playwright__browser_evaluate` to inspect DOM state or run diagnostic scripts