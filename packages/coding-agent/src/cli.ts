#!/usr/bin/env node
/**
 * CLI entry point for the refactored coding agent.
 * Uses main.ts with AgentSession and new mode modules.
 *
 * Test with: npx tsx src/cli-new.ts [args...]
 */
import { configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { APP_NAME } from "./config.ts";
import { main } from "./main.ts";

process.title = APP_NAME;
process.env[`${APP_NAME.toUpperCase()}_CODING_AGENT`] = "true";
process.emitWarning = (() => {}) as typeof process.emitWarning;

configureHttpDispatcher();

main(process.argv.slice(2));
