/**
 * Type definitions for Commander.js CLI options
 *
 * These interfaces define the option types for the atomic CLI commands.
 * They are used with @commander-js/extra-typings for type-safe option parsing.
 */

import type { AgentKey } from "../config";

/**
 * Global options available to all commands
 *
 * These options can be used with any command and control
 * cross-cutting concerns like output formatting and confirmations.
 */
export interface GlobalOptions {
  /**
   * Overwrite all config files including CLAUDE.md/AGENTS.md
   * Bypasses the preservation logic for user-customized files
   */
  force?: boolean;

  /**
   * Auto-confirm all prompts (non-interactive mode)
   * Useful for CI/CD pipelines and scripted usage
   */
  yes?: boolean;

  /**
   * Skip ASCII banner display
   * Reduces visual noise in automated environments
   */
  noBanner?: boolean;

  /**
   * Internal flag for spawning telemetry upload process
   * Hidden from help output - used only by the CLI internally
   */
  uploadTelemetry?: boolean;
}

/**
 * Options for the init command
 *
 * Controls the agent configuration setup process.
 */
export interface InitOptions {
  /**
   * Pre-select an agent to skip the interactive selection prompt
   * Valid values are keys from AGENT_CONFIG (e.g., "claude", "copilot")
   */
  agent?: AgentKey;
}

/**
 * Options for the uninstall command
 *
 * Controls how the uninstallation process behaves.
 */
export interface UninstallOptions {
  /**
   * Preview what would be removed without actually removing anything
   * Useful for verifying the uninstall scope before committing
   */
  dryRun?: boolean;

  /**
   * Keep configuration data, only remove the binary
   * Preserves user settings for potential reinstallation
   */
  keepConfig?: boolean;
}

/**
 * Options for the ralph setup command
 *
 * Controls the Ralph Wiggum loop initialization.
 */
export interface RalphSetupOptions {
  /**
   * The agent to use for the Ralph loop
   * Currently only "claude" is supported
   */
  agent: "claude";

  /**
   * Maximum iterations before auto-stop
   * Set to 0 for unlimited iterations (default)
   */
  maxIterations?: number;

  /**
   * Promise phrase that signals loop completion
   * The loop exits when this exact text is detected in <promise> tags
   */
  completionPromise?: string;

  /**
   * Path to the feature list JSON file
   * Default: "research/feature-list.json"
   */
  featureList?: string;
}

/**
 * Options for the ralph stop command
 *
 * Controls the Ralph loop termination (called by hooks).
 */
export interface RalphStopOptions {
  /**
   * The agent whose Ralph loop to stop
   * Currently only "claude" is supported
   */
  agent: "claude";
}

/**
 * Combined options type for commands that inherit global options
 *
 * Use this when you need both command-specific and global options.
 *
 * @example
 * type InitCommandOptions = CommandOptions<InitOptions>;
 * // Results in: { agent?: AgentKey; force?: boolean; yes?: boolean; ... }
 */
export type CommandOptions<T> = T & GlobalOptions;
