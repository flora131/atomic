import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ClaudeExecutablePathResolutionOptions {
  platform: NodeJS.Platform;
  homeDir: string;
  claudeFromPath: string | null;
  sdkCliPath: string | null;
  envOverridePath: string | null;
  pathExists: (path: string) => boolean;
  resolveRealPath: (path: string) => string;
}

interface ClaudeExecutableCandidate {
  invokePath: string;
  canonicalPath: string;
}

function isLikelyNodeModulesClaudePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    normalized.includes("/node_modules/") ||
    normalized.includes("/.bun/install/") ||
    normalized.endsWith("/cli.js")
  );
}

function resolveClaudeExecutableCandidate(
  candidate: string | null,
  options: Pick<
    ClaudeExecutablePathResolutionOptions,
    "pathExists" | "resolveRealPath"
  >,
): ClaudeExecutableCandidate | null {
  if (!candidate || !options.pathExists(candidate)) {
    return null;
  }

  try {
    const canonicalPath = options.resolveRealPath(candidate);
    if (options.pathExists(canonicalPath)) {
      return {
        invokePath: candidate,
        canonicalPath,
      };
    }
  } catch {
    // Fall back to the unresolved candidate path.
  }

  return {
    invokePath: candidate,
    canonicalPath: candidate,
  };
}

export function resolveClaudeCodeExecutablePath(
  options: ClaudeExecutablePathResolutionOptions,
): string | null {
  const claudeFromPath = resolveClaudeExecutableCandidate(
    options.claudeFromPath,
    options,
  );
  const sdkCliPath = resolveClaudeExecutableCandidate(options.sdkCliPath, options);
  const envOverridePath = resolveClaudeExecutableCandidate(
    options.envOverridePath,
    options,
  );

  if (envOverridePath) {
    return envOverridePath.invokePath;
  }

  if (options.platform === "darwin") {
    const macNativeCandidates = [
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/Applications/Claude Code.app/Contents/MacOS/claude",
      join(options.homeDir, ".local", "bin", "claude"),
      join(options.homeDir, ".claude", "local", "claude"),
      join(options.homeDir, "bin", "claude"),
      "/Applications/Claude.app/Contents/MacOS/claude",
      join(
        options.homeDir,
        "Applications",
        "Claude.app",
        "Contents",
        "MacOS",
        "claude",
      ),
      join(
        options.homeDir,
        "Applications",
        "Claude Code.app",
        "Contents",
        "MacOS",
        "claude",
      ),
    ];

    for (const candidate of macNativeCandidates) {
      const resolved = resolveClaudeExecutableCandidate(candidate, options);
      if (resolved && !isLikelyNodeModulesClaudePath(resolved.canonicalPath)) {
        return resolved.invokePath;
      }
    }

    if (
      claudeFromPath &&
      !isLikelyNodeModulesClaudePath(claudeFromPath.canonicalPath)
    ) {
      return claudeFromPath.invokePath;
    }

    if (sdkCliPath && !isLikelyNodeModulesClaudePath(sdkCliPath.canonicalPath)) {
      return sdkCliPath.invokePath;
    }

    return claudeFromPath?.invokePath ?? sdkCliPath?.invokePath ?? null;
  }

  if (
    claudeFromPath &&
    !isLikelyNodeModulesClaudePath(claudeFromPath.canonicalPath)
  ) {
    return claudeFromPath.invokePath;
  }

  return claudeFromPath?.invokePath ?? sdkCliPath?.invokePath ?? null;
}

export function getBundledClaudeCodePath(): string {
  const envOverridePath =
    process.env.ATOMIC_CLAUDE_CODE_EXECUTABLE?.trim() || null;
  let sdkCliPath: string | null = null;
  try {
    const sdkUrl = import.meta.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkPath = fileURLToPath(sdkUrl);
    sdkCliPath = join(dirname(sdkPath), "cli.js");
  } catch {
    // Falls through to path lookup.
  }

  const resolvedPath = resolveClaudeCodeExecutablePath({
    platform: process.platform,
    homeDir: homedir(),
    claudeFromPath: Bun.which("claude") ?? Bun.which("claude-code"),
    sdkCliPath,
    envOverridePath,
    pathExists: existsSync,
    resolveRealPath: realpathSync,
  });

  if (resolvedPath) {
    return resolvedPath;
  }

  throw new Error(
    "Cannot find Claude Code CLI.\n\n" +
      "Install Claude Code by visiting: https://code.claude.com/docs/en/setup\n\n" +
      "Or ensure 'claude' is available in your PATH.",
  );
}
