/**
 * Source Control Provider Interface
 *
 * Defines the contract for source control providers (GitHub, Sapling, etc.)
 * Each provider implements this interface to enable provider-agnostic commands.
 */

/**
 * Result of checking provider prerequisites
 */
export interface PrerequisiteResult {
  /** Whether all prerequisites are satisfied */
  satisfied: boolean;
  /** List of missing prerequisites */
  missing: string[];
  /** Installation instructions for each missing prerequisite */
  installInstructions: Record<string, string>;
}

/**
 * Command mappings for source control operations
 */
export interface ProviderCommands {
  // Status & info
  status: string;
  log: string;
  diff: string;
  branch: string;

  // Staging & committing
  add: string;
  commit: string;
  amend: string;

  // Remote operations
  push: string;
  pull: string;

  // PR/code review
  createPR: string;
  listPRs: string;
  viewPR: string;
}

/**
 * Source control provider names
 */
export type ProviderName = "github" | "sapling";

/**
 * CLI tool used by the provider
 */
export type ProviderCLI = "git" | "sl";

/**
 * Source Control Provider Interface
 *
 * Implement this interface to add support for a new source control system.
 */
export interface SourceControlProvider {
  /** Provider identifier */
  name: ProviderName;

  /** Display name for UI */
  displayName: string;

  /** Primary CLI tool */
  cli: ProviderCLI;

  /** Command mappings for templates */
  commands: ProviderCommands;

  /** Allowed tool patterns for YAML frontmatter */
  allowedTools: string[];

  /** Check if prerequisites are installed */
  checkPrerequisites(): Promise<PrerequisiteResult>;
}

/**
 * Sapling-specific options
 */
export interface SaplingOptions {
  /**
   * PR creation workflow
   * - 'stack': Creates one PR per commit using 'sl pr submit --stack'
   * - 'branch': Traditional branch-based PR using 'sl push --to'
   */
  prWorkflow: "stack" | "branch";
}

/**
 * GitHub-specific options (for future extensibility)
 */
export interface GitHubOptions {
  // Reserved for future GitHub-specific options
}

/**
 * Source control configuration in .atomic/config.yaml
 */
export interface SourceControlConfig {
  /** Selected provider */
  provider: ProviderName;

  /** Sapling-specific options */
  sapling?: SaplingOptions;

  /** GitHub-specific options */
  github?: GitHubOptions;
}

/**
 * Atomic project configuration schema (.atomic/config.yaml)
 */
export interface AtomicConfig {
  /** Configuration schema version */
  version: 1;

  /** Source control settings */
  sourceControl: SourceControlConfig;
}

/**
 * Default Sapling options
 */
export const DEFAULT_SAPLING_OPTIONS: SaplingOptions = {
  prWorkflow: "stack",
};

/**
 * Default GitHub options
 */
export const DEFAULT_GITHUB_OPTIONS: GitHubOptions = {};
