---
date: 2026-02-05 01:14:03 UTC
researcher: Claude Opus 4.5
git_commit: 676408d949ed82b9a4ec5bcc676ac4a24b622073
branch: lavaman131/feature/tui
repository: atomic
topic: "Model command header update mechanism and provider-specific model filtering"
tags: [research, codebase, model-selector, header, providers, claude, opencode, copilot]
status: complete
last_updated: 2026-02-05
last_updated_by: Claude Opus 4.5
---

# Research: Model Command Header Update and Provider-Specific Model Filtering

## Research Question

Research the `/model` command for all providers (`copilot`, `opencode`, `claude`) to understand:
1. How to fix the header for the model name to also update when the model is changed
2. Ensure Claude model selector shows only Anthropic models from models.dev
3. Ensure OpenCode shows only models.dev models for which user has authenticated
4. Ensure Copilot option shows only GitHub provider models from models.dev

## Summary

The current Atomic TUI implementation has a **static header model display issue**: the `AtomicHeader` component receives the `model` prop only once during initial render, and it does not update when the model is changed via the `/model` command. The solution requires passing the `currentModelId` state (which is already tracked and updated when model changes) to the header component.

For model filtering:
- **Claude**: Current implementation in `UnifiedModelOperations` already filters to `['anthropic']` provider only
- **OpenCode**: Should filter to all providers but only show models for authenticated providers (based on environment variables, stored auth tokens, or config)
- **Copilot**: Current implementation filters to `['github-copilot', 'github-models']` providers only

## Detailed Findings

### 1. Header Update Issue - Root Cause

#### Current Architecture (Atomic)

**File: `src/ui/chat.tsx`**

The `AtomicHeader` component receives `model` as a prop passed from `ChatApp`:

```tsx:src/ui/chat.tsx:2119-2125
{/* Header */}
<AtomicHeader
  version={version}
  model={model}        // <-- Static prop, never updated
  tier={tier}
  workingDir={workingDir}
/>
```

The `model` prop comes from `ChatAppProps` and is set once during component initialization in `src/commands/chat.ts`:166-177.

However, the codebase already tracks `currentModelId` state that IS updated when model changes:

```tsx:src/ui/chat.tsx:904
const [currentModelId, setCurrentModelId] = useState<string | undefined>(undefined);
```

This state is updated in two places:
1. After model selection in `handleModelSelect`:1392 - `setCurrentModelId(model.id)`
2. When showing model selector in command result handling:1580 - `setCurrentModelId(currentModel)`

#### The Fix Required

The header should receive `currentModelId` (or a derived display name) instead of the static `model` prop:

```tsx
<AtomicHeader
  version={version}
  model={currentModelId ? formatModelDisplayName(currentModelId) : model}
  tier={tier}
  workingDir={workingDir}
/>
```

### 2. Reference Implementation: OpenCode

**Source**: [DeepWiki anomalyco/opencode](https://deepwiki.com/wiki/anomalyco/opencode#4.2)

In OpenCode's TUI, the model display is handled differently:
- The model is NOT displayed in the Header component (`packages/opencode/src/cli/cmd/tui/routes/session/header.tsx`)
- Instead, it's displayed in the **Prompt** component (`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:983-985`)
- Uses `local.model.parsed()` which is a reactive SolidJS memo
- Automatic re-rendering when `modelStore` changes

**Key Pattern from OpenCode**:
```typescript
// packages/opencode/src/cli/cmd/tui/context/local.tsx
parsed() {
  const current = currentModel();
  // Find provider and model info from sync.data.provider
  // Returns { provider: string, model: string, reasoning: boolean }
}
```

### 3. Reference Implementation: Claude SDK

**Source**: [Agent SDK reference - TypeScript](https://platform.claude.com/docs/en/agent-sdk/typescript)

The Claude Agent SDK provides model management through:

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  setModel(model?: string): Promise<void>;
  supportedModels(): Promise<ModelInfo[]>;
}
```

**Critical Finding**: The SDK does NOT emit a dedicated event when model changes. The model is communicated through:
1. **Initial `SDKSystemMessage`** (type: 'system', subtype: 'init') - Contains the `model` field
2. **Message metadata** - Each `SDKAssistantMessage.message.model` field

**Current Atomic Pattern** (from `src/sdk/claude-client.ts:514-520`):
```typescript
// Capture model from system init message
if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
  const systemMsg = sdkMessage as SDKSystemMessage;
  if (systemMsg.model && !this.detectedModel) {
    this.detectedModel = systemMsg.model;
  }
}
```

**Known Issue**: `supportedModels()` returns incomplete list - missing `opus`, `opusplan`, `sonnet[1m]`. See [GitHub Issue #117](https://github.com/anthropics/claude-agent-sdk-typescript/issues/117).

### 4. Reference Implementation: Copilot SDK

**Source**: [DeepWiki github/copilot-sdk](https://deepwiki.com/wiki/github/copilot-sdk)

The Copilot SDK provides:

```typescript
// List available models
const models = await client.listModels();

// Create session with specific model
const session = await client.createSession({ model: "gpt-5.2" });
```

**Key Events**:
- `session.model_change` - Indicates model change (this IS available in Copilot SDK!)
- Model list is cached, invalidated on disconnect
- Requires authentication for `listModels()`

**ModelInfo Structure**:
```typescript
interface ModelInfo {
  id: string;
  name: string;
  capabilities: { supports: { vision, reasoning_effort }, limits: { max_prompt_tokens } };
  policy?: { state: "enabled" | "disabled" | "unconfigured" };
  billing?: { multiplier: number };
}
```

### 5. Model Filtering - Current Implementation

**File: `src/models/model-operations.ts:96-124`**

```typescript
async listAvailableModels(): Promise<Model[]> {
  const data = await ModelsDev.get();
  const models: Model[] = [];

  // Provider filters for each agent type
  const providerFilters: Record<AgentType, string[] | null> = {
    claude: ['anthropic'],
    opencode: null, // null means all providers
    copilot: ['github-copilot', 'github-models'],
  };

  const allowedProviders = providerFilters[this.agentType];

  for (const [providerID, provider] of Object.entries(data)) {
    if (allowedProviders !== null && !allowedProviders.includes(providerID)) {
      continue;
    }
    for (const [modelID, model] of Object.entries(provider.models)) {
      if (model.status === 'deprecated') continue;
      models.push(fromModelsDevModel(providerID, modelID, model, provider.api));
    }
  }
  return models;
}
```

### 6. OpenCode Provider Authentication Filtering

**Source**: `packages/opencode/src/provider/provider.ts` (from DeepWiki)

OpenCode determines authenticated providers through:

1. **Environment Variables**: Checks provider-specific vars (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
2. **Stored Tokens**: `~/.local/share/opencode/auth.json` (set via `/connect` command)
3. **Configuration**: API keys in `opencode.json`

**Filtering Logic**:
```typescript
// CUSTOM_LOADERS.opencode
if (no_key_found) {
  // Remove models with non-zero input costs
  provider.models = provider.models.filter(m => !m.cost?.input);
}
```

### 7. Copilot Model Availability

**Source**: [GitHub Docs - Supported Models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

**Currently Available GitHub Models** (from models.dev `github-copilot` and `github-models` providers):
- OpenAI: GPT-5.2, GPT-5.1, GPT-5.1-Codex, GPT-5.1-Codex-Max, etc.
- Anthropic: Claude Haiku 4.5, Claude Opus 4.5, Claude Sonnet 4.5
- Google: Gemini 2.5 Pro, Gemini 3 Flash/Pro
- Others: Grok Code Fast 1, Raptor mini

**Model Policy States**:
- `enabled` - Model available
- `disabled` - Model not available
- `unconfigured` - Requires setup

## Code References

| Purpose | File Path | Line Numbers |
|---------|-----------|--------------|
| Header component | `src/ui/chat.tsx` | 573-605 |
| Header usage | `src/ui/chat.tsx` | 2119-2125 |
| currentModelId state | `src/ui/chat.tsx` | 904 |
| Model selection handler | `src/ui/chat.tsx` | 1385-1396 |
| Model operations | `src/models/model-operations.ts` | 72-179 |
| Provider filters | `src/models/model-operations.ts` | 101-105 |
| models.dev data | `src/models/models-dev.ts` | 30-283 |
| Model transform | `src/models/model-transform.ts` | 1-111 |
| Claude client | `src/sdk/claude-client.ts` | 514-520 |
| Chat command | `src/commands/chat.ts` | 166-177 |

## Architecture Documentation

### Current Model State Flow

```
┌─────────────────┐    Initial    ┌─────────────────┐
│  chat.ts        │──────────────▶│  ChatApp props  │
│  (model option) │               │  (static model) │
└─────────────────┘               └─────────────────┘
                                          │
                                          ▼
                                  ┌─────────────────┐
                                  │  AtomicHeader   │
                                  │  (static model) │
                                  └─────────────────┘

┌─────────────────┐   /model cmd  ┌─────────────────┐
│  ModelSelector  │──────────────▶│  currentModelId │
│  Dialog         │               │  (useState)     │
└─────────────────┘               └─────────────────┘
                                          │
                                          ▼
                                  ┌─────────────────┐
                                  │    NOWHERE      │
                                  │  (not connected)│
                                  └─────────────────┘
```

### Proposed Model State Flow

```
┌─────────────────┐    Initial    ┌─────────────────┐
│  chat.ts        │──────────────▶│  initialModel   │
│  (model option) │               │  (prop)         │
└─────────────────┘               └─────────────────┘
                                          │
                                          ▼
                                  ┌─────────────────┐
│  ModelSelector  │──────────────▶│  currentModelId │◀──┐
│  Dialog         │   setModel    │  (useState)     │   │
└─────────────────┘               └─────────────────┘   │
                                          │            │
                                          ▼            │
                                  ┌─────────────────┐   │
                                  │  AtomicHeader   │───┘
                                  │  (reactive)     │  derives
                                  └─────────────────┘  display name
```

### Provider-Specific Model Filtering Summary

| Agent Type | Provider Filter | Authentication Check | Additional Logic |
|------------|----------------|---------------------|------------------|
| Claude | `['anthropic']` only | N/A (direct API) | Use Claude SDK aliases |
| OpenCode | All providers | Env vars, auth.json, config | Filter unauthenticated provider models |
| Copilot | `['github-copilot', 'github-models']` | GitHub auth via SDK | Respect `ModelPolicy.state` |

## Historical Context

**File: `research/docs/2026-02-03-model-params-workflow-nodes-message-queuing.md`**

Previous research established the model selector dialog pattern with `ModelSelectorDialog` component. The model state management was set up with `currentModelId` but was not connected to the header display.

## Related Research

- `research/docs/2026-01-31-claude-agent-sdk-research.md` - Claude SDK patterns
- `research/docs/2026-01-31-opencode-sdk-research.md` - OpenCode SDK patterns
- `research/docs/2026-01-31-github-copilot-sdk-research.md` - Copilot SDK patterns
- `research/docs/2026-02-03-model-params-workflow-nodes-message-queuing.md` - Model selector implementation

## Open Questions

1. **OpenCode authentication detection**: Should Atomic implement the same multi-source authentication check (env vars, auth file, config) or simplify to just environment variables?

2. **Model change event for Claude**: Since Claude SDK lacks a model change event, should we implement a custom event emission after `setModel()` or rely on re-reading the system init message?

3. **Copilot session recreation**: The Copilot SDK requires `requiresNewSession: true` for model changes. Should we show a warning to users about this, or silently recreate the session?

4. **models.dev provider IDs**: Need to verify exact provider IDs in models.dev match our filter lists:
   - Is it `github-copilot` or `github` for Copilot models?
   - Are there other Anthropic-related provider IDs besides `anthropic`?

## Implementation Recommendations

### 1. Fix Header Model Display

```tsx
// src/ui/chat.tsx - In ChatApp component
const displayModel = useMemo(() => {
  if (currentModelId) {
    return formatModelDisplayName(currentModelId);
  }
  return model; // fallback to initial prop
}, [currentModelId, model]);

// Then in render:
<AtomicHeader
  version={version}
  model={displayModel}
  tier={tier}
  workingDir={workingDir}
/>
```

### 2. OpenCode Authentication-Based Filtering

```typescript
// src/models/model-operations.ts - Add authenticated provider check
async listAvailableModels(): Promise<Model[]> {
  if (this.agentType === 'opencode') {
    const authenticatedProviders = await this.getAuthenticatedProviders();
    // Filter to only authenticated providers
  }
}

private async getAuthenticatedProviders(): Promise<string[]> {
  // Check environment variables for API keys
  // e.g., ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
}
```

### 3. Copilot Policy-Based Filtering

```typescript
// Filter models based on policy state from SDK
const models = await copilotClient.listModels();
const availableModels = models.filter(m => m.policy?.state !== 'disabled');
```

## External References

### Documentation
- [Claude Model Configuration](https://code.claude.com/docs/en/model-config)
- [Claude Agent SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [GitHub Copilot Supported Models](https://docs.github.com/en/copilot/reference/ai-models/supported-models)

### DeepWiki Resources
- [OpenCode TUI Architecture](https://deepwiki.com/wiki/anomalyco/opencode#4.2)
- [OpenCode Model Selection](https://deepwiki.com/wiki/anomalyco/opencode#7.2)
- [Copilot SDK Architecture](https://deepwiki.com/wiki/github/copilot-sdk#3)

### GitHub Issues
- [Claude SDK Issue #117 - Missing model aliases](https://github.com/anthropics/claude-agent-sdk-typescript/issues/117)
- [Claude SDK Issue #140 - supportedAgents() request](https://github.com/anthropics/claude-agent-sdk-typescript/issues/140)
