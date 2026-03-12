import { homedir } from "os";
import { relative, resolve, sep } from "path";
import type { AgentType } from "@/services/telemetry/types.ts";
import type {
  ProviderDiscoveryPlan,
  ProviderDiscoveryPlanOptions,
} from "@/services/config/provider-discovery-plan.ts";
import { buildProviderDiscoveryPlan } from "@/services/config/provider-discovery-plan.ts";

export function buildChatStartupDiscoveryPlan(
  agentType: AgentType,
  options: ProviderDiscoveryPlanOptions = {}
): ProviderDiscoveryPlan {
  return buildProviderDiscoveryPlan(agentType, options);
}

interface ProviderDiscoveryPlanDebugOptions {
  projectRoot?: string;
  homeDir?: string;
}

interface ProviderDiscoveryDebugRoot {
  id: string;
  tier: ProviderDiscoveryPlan["rootsInPrecedenceOrder"][number]["tier"];
  compatibility: ProviderDiscoveryPlan["rootsInPrecedenceOrder"][number]["compatibility"];
  precedence: number;
  exists: boolean;
  pathTemplate: string;
  resolvedPath: string;
}

export interface ProviderDiscoveryPlanDebugOutput {
  provider: ProviderDiscoveryPlan["provider"];
  runtime: ProviderDiscoveryPlan["runtime"];
  paths: {
    atomicBaseline: readonly string[];
    userGlobal: readonly string[];
    projectLocal: readonly string[];
  };
  rootsInPrecedenceOrder: readonly ProviderDiscoveryDebugRoot[];
  existingRootIds: readonly string[];
  compatibilitySets: {
    nativeRootIds: readonly string[];
    compatibilityRootIds: readonly string[];
  };
}

function isChatDebugEnabled(): boolean {
  const debugValue = process.env.DEBUG?.trim().toLowerCase();
  return !!debugValue && (debugValue === "1" || debugValue === "true" || debugValue === "on");
}

function isSameOrDescendantPath(pathValue: string, basePath: string): boolean {
  const resolvedPath = resolve(pathValue);
  const resolvedBasePath = resolve(basePath);
  return resolvedPath === resolvedBasePath || resolvedPath.startsWith(`${resolvedBasePath}${sep}`);
}

function normalizeRelativeForDebug(relativePath: string): string {
  return relativePath.split(sep).join("/");
}

function sanitizeDiscoveryPathForDebug(
  pathValue: string,
  options: Required<ProviderDiscoveryPlanDebugOptions>
): string {
  const resolvedPath = resolve(pathValue);

  if (isSameOrDescendantPath(resolvedPath, options.projectRoot)) {
    const projectRelativePath = relative(options.projectRoot, resolvedPath);
    return projectRelativePath.length > 0
      ? `<project>/${normalizeRelativeForDebug(projectRelativePath)}`
      : "<project>";
  }

  if (isSameOrDescendantPath(resolvedPath, options.homeDir)) {
    const homeRelativePath = relative(options.homeDir, resolvedPath);
    return homeRelativePath.length > 0 ? `~/${normalizeRelativeForDebug(homeRelativePath)}` : "~";
  }

  return "<external-path>";
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    deduped.push(value);
  }

  return deduped;
}

export function buildProviderDiscoveryPlanDebugOutput(
  plan: ProviderDiscoveryPlan,
  options: ProviderDiscoveryPlanDebugOptions = {}
): ProviderDiscoveryPlanDebugOutput {
  const context: Required<ProviderDiscoveryPlanDebugOptions> = {
    projectRoot: resolve(options.projectRoot ?? process.cwd()),
    homeDir: resolve(options.homeDir ?? homedir()),
  };

  const sanitizePath = (pathValue: string) => sanitizeDiscoveryPathForDebug(pathValue, context);

  return {
    provider: plan.provider,
    runtime: plan.runtime,
    paths: {
      atomicBaseline: dedupeStrings(plan.paths.atomicBaseline.map(sanitizePath)),
      userGlobal: dedupeStrings(plan.paths.userGlobal.map(sanitizePath)),
      projectLocal: dedupeStrings(plan.paths.projectLocal.map(sanitizePath)),
    },
    rootsInPrecedenceOrder: plan.rootsInPrecedenceOrder.map((root) => ({
      id: root.id,
      tier: root.tier,
      compatibility: root.compatibility,
      precedence: root.precedence,
      exists: root.exists,
      pathTemplate: root.pathTemplate,
      resolvedPath: sanitizePath(root.resolvedPath),
    })),
    existingRootIds: plan.existingRoots.map((root) => root.id),
    compatibilitySets: {
      nativeRootIds: Array.from(plan.compatibilitySets.nativeRootIds),
      compatibilityRootIds: Array.from(plan.compatibilitySets.compatibilityRootIds),
    },
  };
}

export function logActiveProviderDiscoveryPlan(
  plan: ProviderDiscoveryPlan,
  options: ProviderDiscoveryPlanDebugOptions & {
    logFn?: (message: string) => void;
  } = {}
): void {
  if (!isChatDebugEnabled()) {
    return;
  }

  const debugOutput = buildProviderDiscoveryPlanDebugOutput(plan, options);
  const message = `[chat.discovery.plan] ${JSON.stringify(debugOutput, null, 2)}`;
  const logFn = options.logFn ?? ((value: string) => console.debug(value));
  logFn(message);
}
