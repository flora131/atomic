---
name: playwright-cli
description: Automate browser interactions for navigation, form filling, testing, screenshots, and structured page inspection.
---

# Browser Automation with playwright-cli

Use this skill when a user asks to browse websites, validate UI flows, reproduce web bugs, fill forms, or capture page artifacts.

## Standard workflow

1. Open a browser session.
2. Navigate to the target URL.
3. Capture a snapshot to get element refs.
4. Interact with page elements by ref.
5. Capture evidence (snapshot/screenshot/pdf) if needed.
6. Close the browser when done.

## Quick start

```bash
playwright-cli open https://example.com
playwright-cli snapshot
playwright-cli click e3
playwright-cli fill e4 "user@example.com"
playwright-cli press Enter
playwright-cli snapshot
playwright-cli close
```

## Command patterns

### Navigation

```bash
playwright-cli open [url]
playwright-cli goto <url>
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
playwright-cli close
```

### Interaction

```bash
playwright-cli click <ref> [button]
playwright-cli dblclick <ref> [button]
playwright-cli fill <ref> <text>
playwright-cli type <text>
playwright-cli press <key>
playwright-cli select <ref> <value>
playwright-cli check <ref>
playwright-cli uncheck <ref>
playwright-cli hover <ref>
playwright-cli drag <startRef> <endRef>
playwright-cli upload <file>
```

### Page state and artifacts

```bash
playwright-cli snapshot
playwright-cli snapshot --filename=state.yaml
playwright-cli screenshot
playwright-cli screenshot --filename=page.png
playwright-cli pdf --filename=page.pdf
playwright-cli eval "document.title"
playwright-cli console
playwright-cli network
```

### Tabs and sessions

```bash
playwright-cli tab-list
playwright-cli tab-new [url]
playwright-cli tab-select <index>
playwright-cli tab-close [index]

playwright-cli --session=my-session open https://example.com --persistent
playwright-cli --session=my-session snapshot
playwright-cli session-list
playwright-cli session-stop my-session
playwright-cli session-delete my-session
```

## Best practices

- Prefer `snapshot` frequently to refresh element refs before interacting.
- Use element refs (`e1`, `e2`, ...) from the latest snapshot instead of guessing selectors.
- Keep actions incremental and verify after meaningful steps.
- Use named sessions for multi-step workflows that need persistent login/state.
- Clean up sessions (`session-stop`, `session-delete`) when finished.

## Fallback execution

If global `playwright-cli` is not available, run commands via Bun:

```bash
bunx @playwright/cli open https://example.com
bunx @playwright/cli snapshot
```
