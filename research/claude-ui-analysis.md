# Claude Code UI Analysis

## Chat Experience Elements (Focus Area)

### User Message Format
- Prefix: `❯ ` (chevron with space)
- Text wraps to multiple lines
- No border/box around messages

### Assistant Message Format
- Prefix: `● ` (bullet point)
- Text wraps and streams character by character
- No border/box around messages

### Tool Call States

**In Progress:**
- "Searching for 1 pattern…" (with animated …)
- "(ctrl+o to expand)" hint for collapsible content

**Completed:**
- Collapsed: `● Searched for 1 pattern (ctrl+o to expand)`
- Expanded: Shows full details with fold indicator `⎿`

**Edit Tool:**
- Shows diff with:
  - Line numbers
  - `-` prefix for removed lines (red)
  - `+` prefix for added lines (green)
- Summary: `⎿ Added X lines, removed Y lines`

### Streaming Indicators (Fun animated text)
- `✶ Misting…`
- `✽ Flibbertigibbeting…`
- `· Whatchamacalliting… (thinking)`
- `✶ Levitating…`

### Permission Dialogs
- Box with title: "Edit file" / "Run bash command"
- Filename shown
- Options with number selection:
  1. Yes
  2. Yes, allow all edits during this session (shift+tab)
  3. No
- Footer: "Esc to cancel · Tab to amend"

### Interrupt Flow
- During streaming: "esc to interrupt" hint
- After interrupt: `⎿ Interrupted · What should Claude do instead?`
- Then waits for user input

### Exit Flow
- `/exit` command shows: `⎿ Goodbye!`

### Queued Messages
- Input stays active during streaming
- Messages can be typed and sent (gets queued)
- No explicit queue indicator visible in basic view

## Key Design Principles

1. **Minimalist prefixes**: Just `❯` for user, `●` for assistant
2. **Collapsible content**: Tool calls can be expanded/collapsed
3. **Diff highlighting**: Clear visual for file changes
4. **Fun animations**: Playful streaming indicator texts
5. **Contextual hints**: "esc to interrupt" only shown when streaming
6. **Clean interruption**: Shows "Interrupted" message with prompt for next action

## Implementation Priority for Atomic TUI

1. ✅ "esc to interrupt" hint during streaming
2. ⏳ Streamlined message prefixes (match Claude style)
3. ⏳ Tool call collapsing with (ctrl+o to expand)
4. ⏳ Edit diff visualization with +/- lines
5. ⏳ Fun streaming indicator texts
6. ⏳ Interrupted message after Escape
7. ⏳ Permission dialog styling
