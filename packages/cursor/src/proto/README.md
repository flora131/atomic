# Cursor protocol notes

This directory contains the isolated Cursor protobuf protocol codec and protocol notes. The codec is intentionally minimal and hand-maintained for the message fields Atomic currently uses; generated protobufs can replace or augment it here without touching provider registration.

Known private endpoints (adapted from the MIT-licensed `ndraiman/pi-cursor-provider` project, without copying the proxy implementation):

- Browser login: `https://cursor.com/loginDeepControl?challenge=<pkce>&uuid=<uuid>&mode=login&redirectTarget=cli`
- Login poll: `https://api2.cursor.sh/auth/poll?uuid=<uuid>&verifier=<verifier>`
- Refresh: `POST https://api2.cursor.sh/auth/exchange_user_api_key`
- Model discovery: `POST https://api2.cursor.sh/agent.v1.AgentService/GetUsableModels`
- Agent stream: `POST https://api2.cursor.sh/agent.v1.AgentService/Run`

Centralized headers live in `src/config.ts`, including `x-cursor-client-version: cli-2026.01.09-231024f`, `x-cursor-client-type: cli`, and `x-ghost-mode: true`. `src/transport.ts` is the only module that should construct Cursor RPC headers or HTTP/2 Connect frames.

`src/transport.ts` now exposes an injectable HTTP/2 client and protocol codec seam plus buffered Connect frame helpers. Production defaults use `CursorProtobufProtocolCodec`; `JsonCursorProtocolCodec` is retained only for explicit test fixtures. Run requests write the initial Connect frame before response headers, and stream handles install response/data/error/close listeners eagerly to avoid missed terminal events.

Field provenance (from `ndraiman/pi-cursor-provider` vendored `proto/agent_pb.ts` commit `82fc4e7`, itself derived from MIT `opencode-cursor`):

- `AgentClientMessage.run_request = 1`
- `AgentClientMessage.exec_client_message = 2`
- `AgentClientMessage.conversation_action = 4`
- `AgentRunRequest.conversation_state = 1`, `action = 2`, `model_details = 3`, `mcp_tools = 4`, `conversation_id = 5`, `custom_system_prompt = 8`; `conversation_id` is the stable Atomic session/conversation id when available, while request ids remain per-call tracing/message-id seeds.
- `AgentRunRequest.mcp_tools = 4` contains a `McpTools` wrapper, not direct tool definitions; `McpTools.mcp_tools = 1` repeats `McpToolDefinition` messages.
- `McpToolDefinition.name = 1`, `description = 2`, `input_schema = 3` (UTF-8 JSON schema bytes), `provider_identifier = 4`, `tool_name = 5`
- `ConversationStateStructure.root_prompt_messages_json = 1`, `turns = 8`
- `ConversationAction.user_message_action = 1`, `cancel_action = 3`
- `UserMessageAction.user_message = 1`; `UserMessage.text = 1`, `message_id = 2`
- `ModelDetails.model_id = 1`, `thinking_details = 2`, `display_name = 4`, `max_mode = 7`
- `AgentServerMessage.interaction_update = 1`, `exec_server_message = 2`, `conversation_checkpoint_update = 3`
- `InteractionUpdate.text_delta = 1`, `thinking_delta = 4`, `token_delta = 8`, `turn_ended = 14`
- `ExecServerMessage.exec_id = 15`, `mcp_args = 11`; `McpArgs.name = 1`, `args = 2`, `tool_call_id = 3`, `provider_identifier = 4`, `tool_name = 5`
- `ExecClientMessage.id = 1`, `mcp_result = 11`, `exec_id = 15`; Atomic writes these frames back to the same paused Run stream for tool results rather than encoding tool results as user-message text.

If Cursor changes the private protocol, add or generate updated protobuf message definitions here and keep generated code isolated from provider registration/stream mapping. Do not introduce a localhost OpenAI-compatible proxy or child-process bridge.
