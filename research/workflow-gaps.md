🔴 High-Impact Gaps
1. WorkflowStep rendering pipeline is broken — Events flow, parts are created, but WorkflowStepPartDisplay isn't registered in PART_REGISTRY so step transitions are silently discarded
2. Custom tool discovery (registerCustomTools()) is never called — The entire .atomic/tools/ pipeline is built but never activated, needs to call registerCustomTools() during init
3. OpenCode MCP bridge returns placeholder strings instead of executing actual tool handlers
4. --max-iterations CLI flag is parsed then silently dropped at chat.ts:197, remove this flag completely

🟡 Medium-Impact
- 6 dead modules (debug-subscriber, tool discovery, file-lock, merge, pipeline-logger, tree-hints) — fully implemented, never imported
- 6 unrendered UI components (WorkflowStepPartDisplay, UserQuestionInline, FooterStatus, TimestampDisplay, StreamingBullet, CodeBlock)
- 12 event types emitted but never consumed (session info/warning/title_changed/truncation/compaction, turn start/end, tool partial results, workflow steps, skill invoked)