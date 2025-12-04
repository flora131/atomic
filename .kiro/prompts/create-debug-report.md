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

Use **DeepWiki tools** for repository documentation and context:
- `@deepwiki/ask_question` - Ask questions about a GitHub repository
- `@deepwiki/read_wiki_structure` - Get documentation topics for a repository
- `@deepwiki/read_wiki_contents` - View documentation about a repository

Use **Playwright tools** to interact with web applications for debugging:
- `@playwright/browser_navigate` - Navigate to URLs
- `@playwright/browser_navigate_back` - Go back to the previous page
- `@playwright/browser_navigate_forward` - Go forward in history
- `@playwright/browser_snapshot` - Capture accessibility snapshots (preferred over screenshots)
- `@playwright/browser_take_screenshot` - Take screenshots when visual inspection is needed
- `@playwright/browser_click` - Click on elements
- `@playwright/browser_drag` - Drag and drop between elements
- `@playwright/browser_hover` - Hover over elements
- `@playwright/browser_type` - Type text into elements
- `@playwright/browser_press_key` - Press keyboard keys
- `@playwright/browser_select_option` - Select options in dropdowns
- `@playwright/browser_file_upload` - Upload files
- `@playwright/browser_console_messages` - Get console messages (errors, warnings, logs)
- `@playwright/browser_network_requests` - View network requests
- `@playwright/browser_evaluate` - Execute JavaScript in the browser
- `@playwright/browser_handle_dialog` - Handle browser dialogs
- `@playwright/browser_wait_for` - Wait for text to appear/disappear
- `@playwright/browser_resize` - Resize the browser window
- `@playwright/browser_tab_list` - List browser tabs
- `@playwright/browser_tab_new` - Open new tab
- `@playwright/browser_tab_select` - Select a tab
- `@playwright/browser_tab_close` - Close a tab
- `@playwright/browser_install` - Install the browser
- `@playwright/browser_close` - Close the browser when done

- Use Playwright tools to interact with and inspect the running application:
  - Use `@playwright/browser_console_messages` to check for JavaScript errors
  - Use `@playwright/browser_network_requests` to inspect API calls and responses
  - Use `@playwright/browser_snapshot` to get the current page state
  - Use `@playwright/browser_evaluate` to inspect DOM state or run diagnostic scripts