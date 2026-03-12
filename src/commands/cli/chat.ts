#!/usr/bin/env bun
/**
 * Compatibility barrel for the chat CLI command.
 *
 * The implementation now lives under `commands/cli/chat/`, while the
 * historical `commands/cli/chat.ts` path remains stable.
 */

export * from "@/commands/cli/chat/index.ts";
