# Branch: fix/tui-streaming-rendering

## Overview

This branch addresses TUI bugs related to **streaming content rendering and visual output** across all agents (Claude Code, OpenCode, GitHub Copilot).

## Issues

### #259 — Streaming text blocks clumped together
Thinking traces are not rendered as separate parts during streaming. Text blocks get clumped together instead of being visually distinct.

### #258 — Background agents UI
Footer status bar, Ctrl+F termination flow, and tree view hints are not implemented for background agents. Affects Dev & Production.

### #254 — Subagent output is final state instead of returning control
When a subagent completes, its output is shown as a final state rather than returning control back to the main agent's output stream.

### #248 — Occasional formatting issues from reviewer agent
Sub-agent output (particularly the reviewer agent) occasionally has formatting/rendering issues in the TUI.

### #231 — Reasoning indicator and timer continue after 100%
The reasoning indicator and elapsed timer keep running even after task progress has reached 100%.

## Grouping Rationale

All issues in this branch relate to how the TUI **renders and displays streamed content** — text blocks, agent output, progress indicators, and background agent status. Fixing these together ensures a consistent and correct rendering pipeline.
