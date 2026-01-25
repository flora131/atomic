/**
 * Shared test utilities for telemetry tests
 *
 * This file contains common helper functions used across multiple telemetry test files
 * to reduce duplication and improve maintainability.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import type {
  TelemetryState,
  AtomicCommandEvent,
  CliCommandEvent,
  AgentSessionEvent,
  TelemetryEvent,
} from "../../src/utils/telemetry/types";
import { getEventsFilePath } from "../../src/utils/telemetry/telemetry-cli";

/**
 * Create an enabled telemetry state for testing
 */
export function createEnabledState(): TelemetryState {
  return {
    enabled: true,
    consentGiven: true,
    anonymousId: "test-uuid-1234",
    createdAt: "2026-01-01T00:00:00Z",
    rotatedAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * Create a disabled telemetry state for testing
 */
export function createDisabledState(): TelemetryState {
  return {
    enabled: false,
    consentGiven: false,
    anonymousId: "test-uuid-disabled",
    createdAt: "2026-01-01T00:00:00Z",
    rotatedAt: "2026-01-01T00:00:00Z",
  };
}

/**
 * Create a valid AtomicCommandEvent for testing
 */
export function createAtomicEvent(
  command: AtomicCommandEvent["command"],
  agentType: AtomicCommandEvent["agentType"] = "claude",
  success: boolean = true
): AtomicCommandEvent {
  return {
    anonymousId: "test-uuid-1234",
    eventId: crypto.randomUUID(),
    eventType: "atomic_command",
    timestamp: new Date().toISOString(),
    command,
    agentType,
    success,
    platform: process.platform,
    atomicVersion: "0.1.0",
    source: "cli",
  };
}

/**
 * Create a valid CliCommandEvent for testing
 */
export function createCliEvent(
  commands: string[],
  agentType: CliCommandEvent["agentType"] = "claude"
): CliCommandEvent {
  return {
    anonymousId: "test-uuid-1234",
    eventId: crypto.randomUUID(),
    eventType: "cli_command",
    timestamp: new Date().toISOString(),
    agentType,
    commands,
    commandCount: commands.length,
    platform: process.platform,
    atomicVersion: "0.1.0",
    source: "cli",
  };
}

/**
 * Create a valid AgentSessionEvent for testing
 */
export function createAgentSessionEvent(
  agentType: AgentSessionEvent["agentType"],
  commands: string[]
): AgentSessionEvent {
  const sessionId = crypto.randomUUID();
  return {
    anonymousId: "test-uuid-1234",
    sessionId,
    eventId: sessionId,
    eventType: "agent_session",
    timestamp: new Date().toISOString(),
    agentType,
    commands,
    commandCount: commands.length,
    platform: process.platform,
    atomicVersion: "0.1.0",
    source: "session_hook",
  };
}

/**
 * Read events from JSONL file
 */
export function readEvents(agentType?: string | null): TelemetryEvent[] {
  const eventsPath = getEventsFilePath(agentType as any);
  if (!existsSync(eventsPath)) {
    return [];
  }
  const content = readFileSync(eventsPath, "utf-8");
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as TelemetryEvent);
}

/**
 * Write events to JSONL file
 */
export function writeEventsToJSONL(
  events: TelemetryEvent[],
  agentType?: string | null
): void {
  const eventsPath = getEventsFilePath(agentType as any);
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(eventsPath, content, "utf-8");
}
