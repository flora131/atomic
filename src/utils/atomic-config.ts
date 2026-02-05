/**
 * Atomic Configuration File Management
 *
 * Handles reading/writing .atomic/config.yaml for project-level configuration.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import type {
  AtomicConfig,
  SourceControlConfig,
  ProviderName,
  SaplingOptions,
} from "../providers";

/**
 * Default config file name
 */
export const ATOMIC_CONFIG_FILE = "config.yaml";

/**
 * Default config directory name
 */
export const ATOMIC_CONFIG_DIR = ".atomic";

/**
 * Get the path to the atomic config file
 *
 * @param projectRoot - Project root directory (defaults to cwd)
 * @returns Full path to .atomic/config.yaml
 */
export function getAtomicConfigPath(projectRoot: string = process.cwd()): string {
  return join(projectRoot, ATOMIC_CONFIG_DIR, ATOMIC_CONFIG_FILE);
}

/**
 * Get the path to the atomic config directory
 *
 * @param projectRoot - Project root directory (defaults to cwd)
 * @returns Full path to .atomic/
 */
export function getAtomicConfigDir(projectRoot: string = process.cwd()): string {
  return join(projectRoot, ATOMIC_CONFIG_DIR);
}

/**
 * Check if atomic config exists
 *
 * @param projectRoot - Project root directory
 * @returns True if .atomic/config.yaml exists
 */
export async function atomicConfigExists(
  projectRoot: string = process.cwd()
): Promise<boolean> {
  try {
    await readFile(getAtomicConfigPath(projectRoot), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse YAML content into AtomicConfig
 *
 * Simple YAML parser for our specific config format.
 * We avoid external dependencies for this simple structure.
 *
 * @param content - YAML content string
 * @returns Parsed AtomicConfig
 */
function parseYaml(content: string): AtomicConfig {
  const lines = content.split("\n");
  const config: Partial<AtomicConfig> = {
    sourceControl: {} as SourceControlConfig,
  };

  let currentSection: string | null = null;
  let currentSubsection: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // Check for top-level keys
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      if (trimmed.startsWith("version:")) {
        const parts = trimmed.split(":");
        if (parts.length > 1 && parts[1] !== undefined) {
          config.version = parseInt(parts[1].trim(), 10) as 1;
        }
      } else if (trimmed === "sourceControl:") {
        currentSection = "sourceControl";
        currentSubsection = null;
      } else {
        currentSection = trimmed.replace(":", "");
        currentSubsection = null;
      }
    } else if (currentSection === "sourceControl") {
      // Parse sourceControl section
      const indent = line.search(/\S/);

      if (indent === 2) {
        // Direct child of sourceControl
        if (trimmed.startsWith("provider:")) {
          const parts = trimmed.split(":");
          if (parts.length > 1 && parts[1] !== undefined) {
            config.sourceControl!.provider = parts[1]
              .trim()
              .replace(/['"]/g, "") as ProviderName;
          }
          currentSubsection = null;
        } else if (trimmed === "sapling:") {
          currentSubsection = "sapling";
          config.sourceControl!.sapling = {} as SaplingOptions;
        } else if (trimmed === "github:") {
          currentSubsection = "github";
          config.sourceControl!.github = {};
        }
      } else if (indent === 4 && currentSubsection) {
        // Nested under sapling or github
        const [key, ...valueParts] = trimmed.split(":");
        const value = valueParts.join(":").trim().replace(/['"]/g, "");

        if (currentSubsection === "sapling" && config.sourceControl!.sapling) {
          if (key === "prWorkflow") {
            config.sourceControl!.sapling.prWorkflow = value as "stack" | "branch";
          }
        }
      }
    }
  }

  // Validate required fields
  if (!config.version) {
    throw new Error("Missing required field: version");
  }
  if (!config.sourceControl?.provider) {
    throw new Error("Missing required field: sourceControl.provider");
  }

  return config as AtomicConfig;
}

/**
 * Serialize AtomicConfig to YAML string
 *
 * @param config - Configuration to serialize
 * @returns YAML string
 */
function serializeYaml(config: AtomicConfig): string {
  const lines: string[] = [
    "# Atomic project configuration",
    "# See: https://github.com/atomicagents/atomic for documentation",
    "",
    `version: ${config.version}`,
    "",
    "sourceControl:",
    `  provider: ${config.sourceControl.provider}`,
  ];

  // Add sapling options if present
  if (config.sourceControl.sapling) {
    lines.push("");
    lines.push("  sapling:");
    lines.push(`    prWorkflow: ${config.sourceControl.sapling.prWorkflow}`);
  }

  // Add github options if present (for future extensibility)
  if (config.sourceControl.github && Object.keys(config.sourceControl.github).length > 0) {
    lines.push("");
    lines.push("  github:");
    // Add github-specific options here when they exist
  }

  lines.push(""); // Trailing newline

  return lines.join("\n");
}

/**
 * Read atomic configuration from .atomic/config.yaml
 *
 * @param projectRoot - Project root directory
 * @returns Parsed configuration or null if not found
 */
export async function readAtomicConfig(
  projectRoot: string = process.cwd()
): Promise<AtomicConfig | null> {
  try {
    const content = await readFile(getAtomicConfigPath(projectRoot), "utf-8");
    return parseYaml(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    // Malformed YAML should not crash the CLI — return null so init can
    // fall through to the interactive provider-selection prompt.
    return null;
  }
}

/**
 * Write atomic configuration to .atomic/config.yaml
 *
 * @param config - Configuration to write
 * @param projectRoot - Project root directory
 */
export async function writeAtomicConfig(
  config: AtomicConfig,
  projectRoot: string = process.cwd()
): Promise<void> {
  const configPath = getAtomicConfigPath(projectRoot);
  const configDir = dirname(configPath);

  // Ensure .atomic directory exists
  await mkdir(configDir, { recursive: true });

  // Write config file
  await writeFile(configPath, serializeYaml(config), "utf-8");
}

/**
 * Create a default configuration with the given provider
 *
 * @param provider - Provider name
 * @param options - Provider-specific options
 * @returns Complete AtomicConfig
 */
export function createDefaultConfig(
  provider: ProviderName,
  options?: {
    sapling?: SaplingOptions;
  }
): AtomicConfig {
  const config: AtomicConfig = {
    version: 1,
    sourceControl: {
      provider,
    },
  };

  if (provider === "sapling") {
    config.sourceControl.sapling = options?.sapling ?? { prWorkflow: "stack" };
  }

  return config;
}
