---
date: 2026-01-22 17:30:00 PST
researcher: Claude Code
git_commit: a1ba1e66cc0c19d0367ace715b78d3ba1b4f5d91
branch: flora131/feature/add-anon-telem
repository: atomic
topic: "Phase 6 Backend Integration - Azure App Insights with OpenTelemetry"
tags: [research, telemetry, opentelemetry, azure, app-insights, backend, phase-6]
status: complete
last_updated: 2026-01-22
last_updated_by: Claude Code
---

# Research: Phase 6 Backend Integration - Azure App Insights with OpenTelemetry

## Research Question

Document the current telemetry implementation state (Phases 1-5), identify any existing OpenTelemetry dependencies, analyze the planned upload mechanism architecture, and research Azure App Insights OpenTelemetry integration requirements for Azure Function Apps to prepare Phase 6 backend integration.

## Summary

The Atomic CLI telemetry implementation has completed **Phases 1-4** with Phase 5 (User Consent) partially complete. The system tracks anonymous CLI command usage and slash commands through a local JSONL buffer file. **No upload mechanism exists yet** - this is the core Phase 6 work. The codebase currently has **no OpenTelemetry packages** installed.

For Azure App Insights integration, the recommended approach is to use `@azure/monitor-opentelemetry` (v1.15.0) with the OpenTelemetry Logs API for custom events. This requires special handling for CLI applications (graceful shutdown/flush) since the SDK is designed for long-running servers.

**Key Decision Required**: The spec mentions both "OpenTelemetry Collector backend" and "Azure Monitor" - for a minimal implementation, you can send directly to Azure App Insights without an OTEL Collector middleman.

---

## Current Implementation State

### Phase Status Overview

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| Phase 1 | Foundation (ID generation, state, opt-out) | ✅ Complete | `src/utils/telemetry/telemetry.ts` |
| Phase 2 | Atomic CLI Command Tracking | ✅ Complete | Integrated in `init`, `update`, `uninstall` |
| Phase 3 | Slash Command CLI Tracking | ✅ Complete | Integrated in `run-agent.ts` |
| Phase 4 | Agent Session Hooks | ✅ Complete | Claude, Copilot, OpenCode hooks |
| Phase 5 | User Consent | ⚠️ Partial | Consent prompt exists, config command works |
| Phase 6 | Backend Integration | ❌ Not Started | **This research** |

### File Structure

```
src/utils/telemetry/
├── telemetry.ts           # Core state management, ID generation
├── telemetry-cli.ts       # CLI command tracking, JSONL buffering
├── telemetry-consent.ts   # First-run consent prompt
├── telemetry-session.ts   # Agent session tracking
├── constants.ts           # ATOMIC_COMMANDS list
├── types.ts               # TypeScript interfaces
├── index.ts               # Public API exports
└── *.test.ts              # Test files (7 total)

bin/
└── telemetry-helper.sh    # Shared bash functions for hooks

.claude/hooks/
├── telemetry-stop.sh      # Claude Code Stop hook
└── hooks.json             # Hook registration

.github/hooks/
├── prompt-hook.sh         # Copilot userPromptSubmitted hook
├── stop-hook.sh           # Copilot sessionEnd hook (lines 210-243)
└── hooks.json             # Hook registration

.opencode/plugin/
└── telemetry.ts           # OpenCode TypeScript plugin
```

### Current Dependencies

From `package.json`:

| Package | Version | Purpose |
|---------|---------|---------|
| `@clack/prompts` | `^0.11.0` | Interactive CLI prompts |
| `ci-info` | `^4.3.1` | CI environment detection |

**No OpenTelemetry packages exist.** The telemetry system is fully custom-built.

---

## Detailed Implementation Analysis

### 1. Anonymous ID Generation (`telemetry.ts:40-42`)

```typescript
export function generateAnonymousId(): string {
  return crypto.randomUUID();
}
```

- Uses Node.js built-in `crypto.randomUUID()` (UUID v4)
- IDs rotate monthly based on UTC month/year change (`telemetry.ts:115-138`)
- State persisted to `~/.local/share/atomic/telemetry.json`

### 2. Event Buffering (`telemetry-cli.ts:105-122`)

Events are written to `~/.local/share/atomic/telemetry-events.jsonl`:

```typescript
export function appendEvent(event: TelemetryEvent): void {
  const dataDir = getBinaryDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const line = JSON.stringify(event) + "\n";
  appendFileSync(getEventsFilePath(), line, "utf-8");
}
```

### 3. Event Types (`types.ts`)

Three event types are tracked:

| Type | Source | Fields |
|------|--------|--------|
| `AtomicCommandEvent` | CLI commands | `command`, `agentType`, `success` |
| `CliCommandEvent` | Slash commands in CLI args | `commands[]`, `commandCount` |
| `AgentSessionEvent` | Session hooks | `sessionId`, `commands[]`, `commandCount` |

All include: `anonymousId`, `eventId`, `timestamp`, `platform`, `atomicVersion`, `source`

### 4. Opt-Out Priority Chain (`telemetry.ts:194-219`)

```
1. CI environment (ci-info) → auto-disable
2. ATOMIC_TELEMETRY=0 → disabled
3. DO_NOT_TRACK=1 → disabled
4. telemetry.json state → enabled AND consentGiven required
```

### 5. Missing: Upload Mechanism

The `--upload-telemetry` flag is referenced in:
- Shell hooks: `nohup atomic --upload-telemetry > /dev/null 2>&1 &`
- OpenCode plugin: `spawn(atomicPath, ["--upload-telemetry"])`

**But it is NOT implemented** in `src/index.ts`. The flag does not appear in `parseArgs` options.

---

## Azure App Insights Integration Research

### Package Requirements

```bash
npm install @azure/monitor-opentelemetry @opentelemetry/api @opentelemetry/api-logs
```

**Current Version**: `@azure/monitor-opentelemetry` v1.15.0

**Node.js Requirements**: LTS versions, ESM requires Node.js 18.19.0+

### Connection String Configuration

**Environment Variable (Recommended)**:
```bash
export APPLICATIONINSIGHTS_CONNECTION_STRING="InstrumentationKey=xxx;IngestionEndpoint=https://xxx.applicationinsights.azure.com/"
```

**Programmatic**:
```typescript
import { useAzureMonitor } from "@azure/monitor-opentelemetry";

useAzureMonitor({
  azureMonitorExporterOptions: {
    connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
  },
});
```

### Sending Custom Events (Command Usage)

Custom events are sent via the OpenTelemetry **Logs API** with a special attribute:

```typescript
import { useAzureMonitor } from "@azure/monitor-opentelemetry";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

useAzureMonitor();
const logger = logs.getLogger("atomic-telemetry");

function trackCommand(event: TelemetryEvent): void {
  logger.emit({
    body: `${event.eventType}: ${JSON.stringify(event)}`,
    severityNumber: SeverityNumber.INFO,
    attributes: {
      "microsoft.custom_event.name": event.eventType,  // REQUIRED for customEvents table
      "anonymous_id": event.anonymousId,
      "command": event.command || null,
      "commands": event.commands?.join(",") || null,
      "agent_type": event.agentType,
      "platform": event.platform,
      "version": event.atomicVersion,
      "source": event.source,
      "success": event.success,
    },
  });
}
```

**Key Point**: The `microsoft.custom_event.name` attribute routes events to the `customEvents` table in Application Insights.

### CLI Graceful Shutdown (Critical)

For short-lived CLI processes, telemetry must be explicitly flushed before exit:

```typescript
import { useAzureMonitor, shutdownAzureMonitor } from "@azure/monitor-opentelemetry";

async function handleTelemetryUpload(): Promise<void> {
  // Initialize OpenTelemetry
  useAzureMonitor({
    azureMonitorExporterOptions: {
      connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
    },
    enableLiveMetrics: false,  // Disable for CLI apps
  });

  const logger = logs.getLogger("atomic-telemetry");

  // Read and send buffered events
  const events = readEventsFromJSONL();
  for (const event of events) {
    logger.emit({
      body: event.eventType,
      severityNumber: SeverityNumber.INFO,
      attributes: {
        "microsoft.custom_event.name": event.eventType,
        ...flattenEvent(event),
      },
    });
  }

  // CRITICAL: Flush before exit
  await shutdownAzureMonitor();

  // Clear local buffer on success
  clearEventsFile();
}
```

### Azure Functions Compatibility

If using Azure Functions as a receiving endpoint:

1. **host.json**: Set `"telemetryMode": "OpenTelemetry"`
2. **Do NOT call `shutdown()`** in Functions - use `forceFlush()` only
3. SDK persists across warm invocations

However, for the Atomic CLI use case, **direct export to App Insights** is simpler than deploying a Function.

---

## Architecture Options

### Option A: Direct to App Insights (Recommended for MVP)

```
┌─────────────┐     ┌────────────────────┐     ┌─────────────────────┐
│ Atomic CLI  │ --> │ JSONL Buffer File  │ --> │ Azure App Insights  │
│ & Hooks     │     │ telemetry-events   │     │ (Direct HTTP POST)  │
└─────────────┘     └────────────────────┘     └─────────────────────┘
                                                        │
                                                        v
                                              ┌─────────────────────┐
                                              │ customEvents table  │
                                              │ (KQL queryable)     │
                                              └─────────────────────┘
```

**Pros**: Simplest setup, no infrastructure
**Cons**: Requires connection string in CLI (could be hardcoded or env var)

### Option B: Via OTEL Collector

```
┌─────────────┐     ┌────────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Atomic CLI  │ --> │ JSONL Buffer File  │ --> │ OTEL Collector   │ --> │ Azure App Insights  │
│ & Hooks     │     │ telemetry-events   │     │ (Docker/Cloud)   │     │                     │
└─────────────┘     └────────────────────┘     └──────────────────┘     └─────────────────────┘
```

**Pros**: Vendor-agnostic, can fan out to multiple backends
**Cons**: Requires deploying/maintaining collector infrastructure

### Option C: Hybrid (Future)

Start with Option A, migrate to Option B if needed for scale or multi-backend support.

---

## Proposed Implementation Plan

### Phase 6 Tasks (Backend Integration)

1. **Add Dependencies**
   ```bash
   bun add @azure/monitor-opentelemetry @opentelemetry/api @opentelemetry/api-logs
   ```

2. **Create `src/utils/telemetry/telemetry-upload.ts`**
   - `OTEL_ENDPOINT` constant (App Insights ingestion URL or env var)
   - `initializeOpenTelemetry()` - one-time SDK setup
   - `uploadEvents()` - read JSONL, emit logs, flush
   - `handleTelemetryUpload()` - CLI entry point for `--upload-telemetry`

3. **Add `--upload-telemetry` flag to CLI**
   - Add to `parseArgs` options in `src/index.ts`
   - Handle before main command routing
   - Call `handleTelemetryUpload()` and exit

4. **Implement Spawned Upload Pattern**
   - `spawnTelemetryUpload()` function (already referenced)
   - Call from `beforeExit` handler or after commands
   - Detached child process with `unref()`

5. **Update Shell Helpers**
   - Verify `spawn_upload_process()` in `bin/telemetry-helper.sh` works
   - Test with each agent hook

6. **Configuration**
   - Environment variable: `APPLICATIONINSIGHTS_CONNECTION_STRING`
   - Optional hardcoded fallback for OSS distribution
   - Graceful degradation if connection string missing

### Minimal Code Example

```typescript
// src/utils/telemetry/telemetry-upload.ts
import { useAzureMonitor, shutdownAzureMonitor } from "@azure/monitor-opentelemetry";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { getBinaryDataDir } from "../config-path";
import { join } from "path";
import { isTelemetryEnabledSync } from "./telemetry";
import type { TelemetryEvent } from "./types";

const EVENTS_FILE = () => join(getBinaryDataDir(), "telemetry-events.jsonl");

export async function handleTelemetryUpload(): Promise<void> {
  if (!isTelemetryEnabledSync()) return;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    console.warn("APPLICATIONINSIGHTS_CONNECTION_STRING not set, skipping upload");
    return;
  }

  const eventsPath = EVENTS_FILE();
  if (!existsSync(eventsPath)) return;

  const content = readFileSync(eventsPath, "utf-8");
  const events: TelemetryEvent[] = content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);

  if (events.length === 0) return;

  // Initialize OTEL
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    enableLiveMetrics: false,
  });

  const logger = logs.getLogger("atomic-telemetry");

  // Emit all events
  for (const event of events) {
    logger.emit({
      body: event.eventType,
      severityNumber: SeverityNumber.INFO,
      attributes: {
        "microsoft.custom_event.name": event.eventType,
        "anonymous_id": event.anonymousId,
        "event_id": event.eventId,
        "timestamp": event.timestamp,
        "command": (event as any).command ?? null,
        "commands": (event as any).commands?.join(",") ?? null,
        "command_count": (event as any).commandCount ?? null,
        "agent_type": event.agentType ?? null,
        "platform": event.platform,
        "version": event.atomicVersion,
        "source": event.source,
        "success": (event as any).success ?? null,
      },
    });
  }

  // Flush and shutdown
  await shutdownAzureMonitor();

  // Clear local buffer
  unlinkSync(eventsPath);
}
```

---

## Code References

| File | Lines | Description |
|------|-------|-------------|
| `src/utils/telemetry/telemetry.ts` | 1-271 | Core state management |
| `src/utils/telemetry/telemetry-cli.ts` | 1-215 | CLI tracking, JSONL buffering |
| `src/utils/telemetry/telemetry-consent.ts` | 1-109 | Consent flow |
| `src/utils/telemetry/telemetry-session.ts` | 1-166 | Session tracking |
| `src/utils/telemetry/types.ts` | 1-123 | Type definitions |
| `src/utils/telemetry/constants.ts` | 14-28 | ATOMIC_COMMANDS list |
| `src/index.ts` | 169-184 | `parseArgs` options (missing `--upload-telemetry`) |
| `src/commands/init.ts` | 142-150 | Consent integration |
| `bin/telemetry-helper.sh` | 251-255 | `spawn_upload_process()` |
| `.claude/hooks/telemetry-stop.sh` | 48-56 | Claude hook upload spawn |
| `.opencode/plugin/telemetry.ts` | 195-213 | OpenCode upload spawn |

---

## Historical Context

From `research/docs/2026-01-21-anonymous-telemetry-implementation.md`:
- Triple collection strategy designed
- Local-first buffered telemetry pattern chosen (Homebrew pattern)
- Privacy-preserving by design (no prompts, paths, or IP addresses)
- Monthly ID rotation for enhanced privacy

---

## Recommended Configuration (Best Practices)

Based on industry research of CLI telemetry systems (npm, Homebrew, Segment, OpenTelemetry, Azure Application Insights):

### Retry/TTL Policy

```typescript
const TELEMETRY_CONFIG = {
  retry: {
    maxAttempts: 3,           // Initial + 2 retries (Segment standard)
    initialInterval: 1000,     // 1 second
    maxInterval: 30000,        // 30 seconds
    multiplier: 2.0,           // Exponential backoff (1s, 2s, 4s, ...)
    maxElapsedTime: 300000,    // 5 minutes total (OpenTelemetry standard)
    jitter: 0.5,               // Randomization factor to prevent thundering herd
  },
  timeout: 5000,               // 5 second request timeout (compromise between npm's 1s and OTel's 10s)
};
```

**Rationale**:
- CLI tools prioritize speed over guaranteed delivery
- 3 attempts balances reliability vs. responsiveness
- 5 minute TTL prevents indefinite retry loops
- After TTL expires, events are discarded

### Batch Size Limits

```typescript
const BATCH_LIMITS = {
  maxEvents: 100,              // Segment standard (vs. Mixpanel's 50, OTel's 8192)
  maxPayloadSize: 512000,      // 500 KB (Segment standard)
  maxEventSize: 32768,         // 32 KB per event (Segment standard)
};
```

**Rationale**:
- 100 events balances HTTP payload size with upload frequency
- 500 KB prevents request timeouts on slow connections
- Larger batches are split into multiple requests

### Local Storage Cleanup

```typescript
const STORAGE_LIMITS = {
  maxDiskSize: 52428800,       // 50 MB total (Application Insights standard)
  maxEventAge: 2592000000,     // 30 days in milliseconds
  cleanupOnSuccess: true,      // Remove events after successful upload
};
```

**Rationale**:
- 50 MB prevents unbounded disk growth
- 30-day TTL for debugging while preventing stale data accumulation
- Events older than 30 days are automatically discarded

### Implementation Notes

1. **Fire-and-Forget Pattern**: Like Homebrew, the upload process runs detached - if it fails after max retries, events are discarded silently

2. **No Persistent Queue**: Unlike Application Insights ServerTelemetryChannel (which persists to disk across restarts), Atomic retries only within a single upload session

3. **Batch Splitting**: If JSONL contains >100 events, split into multiple upload requests of 100 events each

4. **Connection String**: Use `APPLICATIONINSIGHTS_CONNECTION_STRING` env var (no hardcoded fallback)

---

## Sources

### Azure App Insights & OpenTelemetry
- [Enable OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-enable)
- [Azure Monitor OpenTelemetry Configuration](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-configuration)
- [Add and Modify OpenTelemetry in Application Insights](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-add-modify)
- [Use OpenTelemetry with Azure Functions](https://learn.microsoft.com/en-us/azure/azure-functions/opentelemetry-howto)
- [@azure/monitor-opentelemetry npm package](https://www.npmjs.com/package/@azure/monitor-opentelemetry)
- [Migrating from Application Insights SDK 2.X to OpenTelemetry](https://learn.microsoft.com/en-us/azure/azure-monitor/app/opentelemetry-nodejs-migrate)
- [Azure Monitor Telemetry Channels](https://learn.microsoft.com/en-us/azure/azure-monitor/app/telemetry-channels)

### Best Practices & Standards
- [OpenTelemetry Collector Resiliency Documentation](https://opentelemetry.io/docs/collector/resiliency/)
- [OpenTelemetry Best Practices (Better Stack)](https://betterstack.com/community/guides/observability/opentelemetry-best-practices/)
- [Segment Analytics Go SDK](https://segment.com/docs/connections/sources/catalog/libraries/server/go/)
- [Mixpanel Android SDK](https://docs.mixpanel.com/docs/tracking-methods/sdks/android)
- [PostHog Go SDK](https://posthog.com/docs/libraries/go)
- [Azure SDK Retry Guidelines](https://azure.github.io/azure-sdk/general_azurecore.html)
