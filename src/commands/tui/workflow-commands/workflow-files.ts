import { existsSync, readdirSync } from "node:fs";
import { join } from "path";
import type { BaseState } from "@/services/workflows/graph/types.ts";
import { VERSION } from "@/version.ts";
import { ralphWorkflowDefinition } from "@/services/workflows/ralph/definition.ts";
import type {
  WorkflowDefinition,
  WorkflowGraphConfig,
  WorkflowMetadata,
  WorkflowStateMigrator,
  WorkflowStateParams,
} from "./types.ts";

export const CUSTOM_WORKFLOW_SEARCH_PATHS = [
  ".atomic/workflows",
  "~/.atomic/workflows",
];

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(process.env.HOME || "", path.slice(2));
  }
  if (path.startsWith("~")) {
    return join(process.env.HOME || "", path.slice(1));
  }
  if (!path.startsWith("/")) {
    return join(process.cwd(), path);
  }
  return path;
}

const SEMVER_PATTERN =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseSemver(version: string): [number, number, number] | null {
  const normalized = version.trim();

  if (!SEMVER_PATTERN.test(normalized)) {
    return null;
  }

  const coreVersion =
    normalized.replace(/^v/i, "").split(/[+-]/, 1)[0] ?? "0.0.0";
  const [major = "0", minor = "0", patch = "0"] = coreVersion.split(".");

  return [
    Number.parseInt(major, 10),
    Number.parseInt(minor, 10),
    Number.parseInt(patch, 10),
  ];
}

function isWorkflowMinSdkNewerThanCurrent(
  minSdkVersion: string,
  currentSdkVersion: string,
): boolean {
  const minVersion = parseSemver(minSdkVersion);
  const currentVersion = parseSemver(currentSdkVersion);

  if (!minVersion || !currentVersion) {
    return false;
  }

  const [minMajor, minMinor, minPatch] = minVersion;
  const [curMajor, curMinor, curPatch] = currentVersion;

  if (minMajor !== curMajor) return minMajor > curMajor;
  if (minMinor !== curMinor) return minMinor > curMinor;
  return minPatch > curPatch;
}

export function discoverWorkflowFiles(): {
  path: string;
  source: "local" | "global";
}[] {
  const discovered: { path: string; source: "local" | "global" }[] = [];

  for (let i = 0; i < CUSTOM_WORKFLOW_SEARCH_PATHS.length; i++) {
    const rawPath = CUSTOM_WORKFLOW_SEARCH_PATHS[i]!;
    const searchPath = expandPath(rawPath);
    const source = i === 0 ? "local" : "global";

    if (existsSync(searchPath)) {
      try {
        const files = readdirSync(searchPath) as string[];
        for (const file of files) {
          if (file.endsWith(".ts")) {
            discovered.push({
              path: join(searchPath, file),
              source,
            });
          }
        }
      } catch {
        // Skip directories we can't read.
      }
    }
  }

  return discovered;
}

let loadedWorkflows: WorkflowDefinition[] = [];

export async function loadWorkflowsFromDisk(): Promise<WorkflowDefinition[]> {
  const discovered = discoverWorkflowFiles();
  const loaded: WorkflowDefinition[] = [];
  const loadedNames = new Set<string>();

  for (const { path, source } of discovered) {
    try {
      const module = await import(path);
      const filename =
        path.split("/").pop()?.replace(".ts", "") ?? "unknown";
      const name = module.name ?? filename;

      if (loadedNames.has(name.toLowerCase())) {
        continue;
      }

      const migrateState =
        typeof module.migrateState === "function"
          ? (module.migrateState as WorkflowStateMigrator)
          : undefined;

      const graphConfig = module.graphConfig as WorkflowGraphConfig | undefined;
      const createState = module.createState as ((params: WorkflowStateParams) => BaseState) | undefined;
      const nodeDescriptions = module.nodeDescriptions as Record<string, string> | undefined;
      const runtime = module.runtime as WorkflowDefinition["runtime"] | undefined;

      if (graphConfig) {
        const nodeIds = new Set(graphConfig.nodes.map((n) => n.id));

        if (!nodeIds.has(graphConfig.startNode)) {
          console.warn(`[workflow:${name}] startNode "${graphConfig.startNode}" not found in nodes`);
        }

        for (const edge of graphConfig.edges) {
          if (!nodeIds.has(edge.from)) {
            console.warn(`[workflow:${name}] edge from "${edge.from}" references unknown node`);
          }
          if (!nodeIds.has(edge.to)) {
            console.warn(`[workflow:${name}] edge to "${edge.to}" references unknown node`);
          }
        }

        const nodesWithEdges = new Set<string>();
        for (const edge of graphConfig.edges) {
          nodesWithEdges.add(edge.from);
          nodesWithEdges.add(edge.to);
        }

        for (const node of graphConfig.nodes) {
          if (node.id !== graphConfig.startNode && !nodesWithEdges.has(node.id)) {
            console.warn(`[workflow:${name}] node "${node.id}" is orphaned (no edges to/from it)`);
          }
        }
      }

      const definition: WorkflowDefinition = {
        name,
        description: module.description ?? `Custom workflow: ${name}`,
        aliases: module.aliases,
        defaultConfig: module.defaultConfig,
        version: module.version,
        minSDKVersion: module.minSDKVersion,
        stateVersion: module.stateVersion,
        migrateState,
        source,
        graphConfig,
        createState,
        nodeDescriptions,
        runtime,
      };

      if (typeof definition.minSDKVersion === "string") {
        if (!parseSemver(definition.minSDKVersion)) {
          console.warn(
            `Workflow "${definition.name}" has invalid minSDKVersion "${definition.minSDKVersion}". Expected semver format like "1.2.3".`,
          );
        } else if (
          isWorkflowMinSdkNewerThanCurrent(
            definition.minSDKVersion,
            VERSION,
          )
        ) {
          console.warn(
            `Workflow "${definition.name}" requires SDK ${definition.minSDKVersion}, but current SDK is ${VERSION}.`,
          );
        }
      }

      loaded.push(definition);
      loadedNames.add(name.toLowerCase());

      if (definition.aliases) {
        for (const alias of definition.aliases) {
          loadedNames.add(alias.toLowerCase());
        }
      }
    } catch (error) {
      console.warn(`Failed to load workflow from ${path}:`, error);
    }
  }

  loadedWorkflows = loaded;
  return loaded;
}

const BUILTIN_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  ralphWorkflowDefinition,
];

export function getAllWorkflows(): WorkflowMetadata[] {
  const allWorkflows: WorkflowMetadata[] = [];
  const seenNames = new Set<string>();

  for (const workflow of loadedWorkflows) {
    const lowerName = workflow.name.toLowerCase();
    if (!seenNames.has(lowerName)) {
      allWorkflows.push(workflow);
      seenNames.add(lowerName);
      if (workflow.aliases) {
        for (const alias of workflow.aliases) {
          seenNames.add(alias.toLowerCase());
        }
      }
    }
  }

  for (const workflow of BUILTIN_WORKFLOW_DEFINITIONS) {
    const lowerName = workflow.name.toLowerCase();
    if (!seenNames.has(lowerName)) {
      allWorkflows.push(workflow);
      seenNames.add(lowerName);
    }
  }

  return allWorkflows;
}

export function getBuiltinWorkflowDefinitions(): WorkflowDefinition[] {
  return BUILTIN_WORKFLOW_DEFINITIONS;
}
