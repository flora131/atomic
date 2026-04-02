/**
 * Agent Schema Validation
 *
 * Validates that all agent definition files in .claude/agents, .opencode/agents,
 * and .github/agents have correct frontmatter schemas derived from their
 * respective SDK types:
 *
 *   - Claude:   AgentDefinition from @anthropic-ai/claude-agent-sdk
 *   - Copilot:  CustomAgentConfig from @github/copilot-sdk
 *   - OpenCode: AgentConfig from @opencode-ai/sdk
 *
 * Run: bun run validate:agents
 */

import { z } from "zod";
import { readdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { parseMarkdownFrontmatter } from "@/lib/markdown.ts";

// ── SDK type imports (type-only, used for compile-time compatibility checks) ──

import type { AgentDefinition, McpServerConfigForProcessTransport } from "@anthropic-ai/claude-agent-sdk";
import type { CustomAgentConfig, MCPServerConfig as CopilotMCPServerConfig } from "@github/copilot-sdk";
import type { AgentConfig as OpenCodeAgentConfig } from "@opencode-ai/sdk/v2";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Must match the pattern used by isValidCommandIdentifier() in definition-integrity.ts */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PROVIDER_DIRS = [
  { provider: "claude", dir: ".claude/agents" },
  { provider: "opencode", dir: ".opencode/agents" },
  { provider: "copilot", dir: ".github/agents" },
] as const;

type Provider = (typeof PROVIDER_DIRS)[number]["provider"];

// ── Shared ─────────────────────────────────────────────────────────────────────

const nameSchema = z
  .string()
  .min(1, "Name must be non-empty")
  .regex(NAME_PATTERN, "Name must start with alphanumeric and contain only letters, numbers, dots, underscores, and hyphens");

// ── Claude Agent SDK schemas ───────────────────────────────────────────────────
// Derived from: AgentDefinition, McpServerConfigForProcessTransport
// @see node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts

/**
 * Zod schema for McpServerConfigForProcessTransport union:
 *   McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfig
 */
const claudeMcpServerConfigSchema: z.ZodType<McpServerConfigForProcessTransport> = z.union([
  z.object({ type: z.literal("http"), url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal("sse"), url: z.string(), headers: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal("stdio").optional(), command: z.string(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional() }),
  z.object({ type: z.literal("sdk"), name: z.string() }),
]);

/**
 * AgentMcpServerSpec = string | Record<string, McpServerConfigForProcessTransport>
 * In frontmatter YAML, this appears as an array of single-key objects:
 *   mcpServers:
 *     - deepwiki:
 *         type: http
 *         url: "..."
 *         tools: ["..."]
 *
 * The `tools` field in frontmatter MCP entries is an extra field the CLI
 * recognizes but is not part of the SDK transport config -- allow it via
 * passthrough on the inner objects.
 */
const claudeMcpServerSpecSchema = z.union([
  z.string(),
  z.record(z.string(), claudeMcpServerConfigSchema.and(
    z.looseObject({ tools: z.array(z.string()).optional() }),
  )),
]);

/**
 * Claude frontmatter schema. Mirrors AgentDefinition fields that appear in
 * YAML frontmatter. The `prompt` field maps to the markdown body, not
 * frontmatter. The `tools` field is serialized as a comma-separated string
 * in Claude's .md format (parsed to string[] at runtime).
 *
 * `name` is not part of AgentDefinition but is used for agent registration
 * (maps to AgentInfo.name) and defaults to the filename when omitted.
 */
const claudeFrontmatterSchema = z.strictObject({
  // Registration field (maps to AgentInfo.name)
  name: nameSchema.optional(),
  // AgentDefinition.description
  description: z.string().min(1, "Description must be non-empty"),
  // AgentDefinition.tools — serialized as comma-separated string in frontmatter
  tools: z.string().min(1, "Tools must be a non-empty comma-separated string"),
  // AgentDefinition.model
  model: z.string().min(1).optional(),
  // AgentDefinition.mcpServers
  mcpServers: z.array(claudeMcpServerSpecSchema).optional(),
  // AgentDefinition.disallowedTools
  disallowedTools: z.array(z.string()).optional(),
  // AgentDefinition.skills
  skills: z.array(z.string()).optional(),
  // AgentDefinition.maxTurns
  maxTurns: z.number().int().positive().optional(),
});

// Compile-time check: ensure our schema fields are assignable to the SDK type.
// `prompt` comes from the markdown body; `tools` is comma-separated in
// frontmatter but string[] in the SDK; `mcpServers` has a frontmatter-specific
// wrapper format. The remaining fields must match AgentDefinition directly.
type _ClaudeFieldCheck = {
  description: AgentDefinition["description"];
  model: AgentDefinition["model"];
  disallowedTools: AgentDefinition["disallowedTools"];
  skills: AgentDefinition["skills"];
  maxTurns: AgentDefinition["maxTurns"];
};

// ── Copilot SDK schemas ────────────────────────────────────────────────────────
// Derived from: CustomAgentConfig, MCPServerConfig (MCPLocalServerConfig | MCPRemoteServerConfig)
// @see node_modules/@github/copilot-sdk/dist/types.d.ts

/**
 * MCPServerConfigBase: { tools: string[]; type?: string; timeout?: number }
 * MCPLocalServerConfig: { type?: "local" | "stdio"; command: string; args: string[]; env?; cwd? }
 * MCPRemoteServerConfig: { type: "http" | "sse"; url: string; headers? }
 */
const copilotMcpServerConfigSchema: z.ZodType<CopilotMCPServerConfig> = z.union([
  z.object({
    type: z.enum(["local", "stdio"]).optional(),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().optional(),
    tools: z.array(z.string()),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.enum(["http", "sse"]),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    tools: z.array(z.string()),
    timeout: z.number().optional(),
  }),
]);

/**
 * Copilot frontmatter schema. Mirrors CustomAgentConfig fields.
 * `prompt` maps to the markdown body. Frontmatter uses `mcp-servers`
 * (hyphenated) which the loader maps to `mcpServers`.
 *
 * The SDK has `name: string` (required), but in frontmatter it's optional
 * because the filename is used as a fallback.
 */
const copilotFrontmatterSchema = z.strictObject({
  // CustomAgentConfig.name (optional in frontmatter, defaults to filename)
  name: nameSchema.optional(),
  // CustomAgentConfig.displayName
  displayName: z.string().min(1).optional(),
  // CustomAgentConfig.description
  description: z.string().min(1, "Description must be non-empty"),
  // CustomAgentConfig.tools (string[] | null in SDK; array in frontmatter)
  tools: z.array(z.string().min(1)).min(1, "Tools array must not be empty"),
  // CustomAgentConfig.mcpServers — hyphenated key in frontmatter YAML
  "mcp-servers": z.record(z.string(), copilotMcpServerConfigSchema).optional(),
  // CustomAgentConfig.infer
  infer: z.boolean().optional(),
});

// Compile-time check: ensure frontmatter field types align with CustomAgentConfig.
type _CopilotFieldCheck = {
  name: CustomAgentConfig["name"];
  displayName: CustomAgentConfig["displayName"];
  description: CustomAgentConfig["description"];
  tools: NonNullable<CustomAgentConfig["tools"]>;
  infer: CustomAgentConfig["infer"];
};

// ── OpenCode SDK schemas ───────────────────────────────────────────────────────
// Derived from: AgentConfig (v2), PermissionConfig
// Source Zod schema: Agent.Info in packages/opencode/src/agent/agent.ts
// @see node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts

/**
 * PermissionConfig (v2 types.gen.d.ts:951-970)
 *   = PermissionActionConfig
 *   | { read?, edit?, glob?, grep?, list?, bash?, task?,
 *       external_directory?, todowrite?, question?, webfetch?,
 *       websearch?, codesearch?, lsp?, doom_loop?, skill?,
 *       [key: string]: ... }
 *
 * PermissionActionConfig = "ask" | "allow" | "deny"
 * PermissionRuleConfig   = PermissionActionConfig | { [key: string]: PermissionActionConfig }
 */
const openCodePermissionActionSchema = z.enum(["ask", "allow", "deny"]);
const openCodePermissionRuleSchema = z.union([
  openCodePermissionActionSchema,
  z.record(z.string(), openCodePermissionActionSchema),
]);

const openCodePermissionConfigSchema = z.union([
  openCodePermissionActionSchema,
  z.looseObject({
    read: openCodePermissionRuleSchema.optional(),
    edit: openCodePermissionRuleSchema.optional(),
    glob: openCodePermissionRuleSchema.optional(),
    grep: openCodePermissionRuleSchema.optional(),
    list: openCodePermissionRuleSchema.optional(),
    bash: openCodePermissionRuleSchema.optional(),
    task: openCodePermissionRuleSchema.optional(),
    external_directory: openCodePermissionRuleSchema.optional(),
    todowrite: openCodePermissionActionSchema.optional(),
    question: openCodePermissionActionSchema.optional(),
    webfetch: openCodePermissionActionSchema.optional(),
    websearch: openCodePermissionActionSchema.optional(),
    codesearch: openCodePermissionActionSchema.optional(),
    lsp: openCodePermissionRuleSchema.optional(),
    doom_loop: openCodePermissionActionSchema.optional(),
    skill: openCodePermissionRuleSchema.optional(),
  }),
]);

/**
 * OpenCode frontmatter schema derived from v2 AgentConfig (types.gen.d.ts:971-1017)
 * and the source Zod schema Agent.Info (packages/opencode/src/agent/agent.ts).
 *
 * Differences from the programmatic AgentConfig:
 *   - `name` is added (used for agent registration, defaults to filename)
 *   - `prompt` comes from the markdown body, not the frontmatter
 *   - AgentConfig has `[key: string]: unknown`, so passthrough is used
 */
const openCodeFrontmatterSchema = z.looseObject({
  // Registration field (maps to Agent.Info.name)
  name: nameSchema.optional(),
  // AgentConfig.description
  description: z.string().min(1, "Description must be non-empty"),
  // AgentConfig.permission
  permission: openCodePermissionConfigSchema,
  // AgentConfig.mode
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  // AgentConfig.model
  model: z.string().optional(),
  // AgentConfig.variant
  variant: z.string().optional(),
  // AgentConfig.hidden
  hidden: z.boolean().optional(),
  // AgentConfig.disable
  disable: z.boolean().optional(),
  // AgentConfig.color
  color: z.string().optional(),
  // AgentConfig.steps
  steps: z.number().int().positive().optional(),
  // AgentConfig.temperature
  temperature: z.number().optional(),
  // AgentConfig.top_p
  top_p: z.number().optional(),
  // AgentConfig.options
  options: z.record(z.string(), z.unknown()).optional(),
});

// Compile-time: verify mode enum matches SDK v2 type.
type _OpenCodeModeCheck = NonNullable<OpenCodeAgentConfig["mode"]> extends
  "subagent" | "primary" | "all" ? true : never;

// ── Schema Lookup ──────────────────────────────────────────────────────────────

const SCHEMAS: Record<Provider, z.ZodType> = {
  claude: claudeFrontmatterSchema,
  opencode: openCodeFrontmatterSchema,
  copilot: copilotFrontmatterSchema,
};

// ── Validation Logic ───────────────────────────────────────────────────────────

interface ValidationError {
  provider: Provider;
  file: string;
  issues: string[];
}

function validateAgentFile(
  filePath: string,
  provider: Provider,
): ValidationError | null {
  const issues: string[] = [];
  const fileName = filePath.split("/").pop()!;

  // Read file
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    return {
      provider,
      file: fileName,
      issues: [`Failed to read file: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  // Parse frontmatter
  const parsed = parseMarkdownFrontmatter(content);
  if (!parsed) {
    return {
      provider,
      file: fileName,
      issues: ["Invalid or missing YAML frontmatter (must be enclosed in --- delimiters)"],
    };
  }

  const { frontmatter, body } = parsed;

  // Validate body is non-empty (this becomes the `prompt` / `systemPrompt` field)
  if (!body.trim()) {
    issues.push("Agent body (instructions after frontmatter) must be non-empty");
  }

  // Validate frontmatter against provider-specific schema
  const schema = SCHEMAS[provider];
  const result = schema.safeParse(frontmatter);

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      issues.push(`${path}${issue.message}`);
    }
  }

  // Verify name matches filename (without .md extension) when explicitly set
  const expectedName = fileName.replace(/\.md$/, "");
  if (
    result.success &&
    typeof frontmatter.name === "string" &&
    frontmatter.name !== expectedName
  ) {
    issues.push(
      `Name "${frontmatter.name}" does not match filename "${expectedName}"`,
    );
  }

  return issues.length > 0 ? { provider, file: fileName, issues } : null;
}

function validateProviderAgents(
  rootDir: string,
  provider: Provider,
  agentDir: string,
): ValidationError[] {
  const fullPath = resolve(rootDir, agentDir);
  const errors: ValidationError[] = [];

  if (!existsSync(fullPath)) {
    errors.push({
      provider,
      file: agentDir,
      issues: [`Directory does not exist: ${fullPath}`],
    });
    return errors;
  }

  let files: string[];
  try {
    files = readdirSync(fullPath).filter((f) => f.endsWith(".md"));
  } catch (err) {
    errors.push({
      provider,
      file: agentDir,
      issues: [`Failed to read directory: ${err instanceof Error ? err.message : String(err)}`],
    });
    return errors;
  }

  if (files.length === 0) {
    errors.push({
      provider,
      file: agentDir,
      issues: ["No agent files (.md) found in directory"],
    });
    return errors;
  }

  for (const file of files.sort()) {
    const error = validateAgentFile(join(fullPath, file), provider);
    if (error) {
      errors.push(error);
    }
  }

  return errors;
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function runAgentValidation(rootDir: string = process.cwd()): boolean {
  console.log("Validating agent schemas...\n");

  let totalFiles = 0;
  let totalErrors = 0;
  const allErrors: ValidationError[] = [];

  for (const { provider, dir } of PROVIDER_DIRS) {
    const fullPath = resolve(rootDir, dir);
    if (!existsSync(fullPath)) {
      continue;
    }

    const files = readdirSync(fullPath).filter((f) => f.endsWith(".md"));
    totalFiles += files.length;

    const errors = validateProviderAgents(rootDir, provider, dir);
    totalErrors += errors.length;
    allErrors.push(...errors);
  }

  if (allErrors.length === 0) {
    console.log(`  All ${totalFiles} agent files passed schema validation.\n`);
    return true;
  }

  for (const { provider, file, issues } of allErrors) {
    console.error(`  FAIL [${provider}] ${file}`);
    for (const issue of issues) {
      console.error(`    - ${issue}`);
    }
  }

  console.error(
    `\n  ${totalErrors} of ${totalFiles} agent files failed validation.\n`,
  );
  return false;
}

// Run as standalone script
if (import.meta.main) {
  const rootDir = process.argv[2] ?? process.cwd();
  const passed = runAgentValidation(rootDir);
  process.exit(passed ? 0 : 1);
}
