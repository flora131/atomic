import { isAbsolute, join, relative, resolve } from "node:path";

export interface DiscoveryPlanOptions {
  projectRoot: string;
  homeDir?: string;
  xdgConfigHome?: string;
  platform: NodeJS.Platform;
}

export function getUserDiscoveryRoots(homeDir: string): string[] {
  const roots = [homeDir, join(homeDir, ".opencode"), join(homeDir, ".copilot")];
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();

  if (xdgConfigHome) {
    roots.push(join(xdgConfigHome, ".opencode"));
    roots.push(join(xdgConfigHome, ".copilot"));
  }

  return Array.from(new Set(roots.map((rootPath) => resolve(rootPath))));
}

export function getGlobalDiscoveryPaths(homeDir: string, directoryName: "agents" | "skills"): string[] {
  const globalPaths = [
    join(homeDir, ".claude", directoryName),
    join(homeDir, ".opencode", directoryName),
    join(homeDir, ".copilot", directoryName),
  ];
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();

  if (xdgConfigHome) {
    globalPaths.push(join(xdgConfigHome, ".opencode", directoryName));
    globalPaths.push(join(xdgConfigHome, ".copilot", directoryName));
  }

  return Array.from(new Set(globalPaths.map((searchPath) => resolve(searchPath))));
}

export function buildRuntimeDiscoveryPlanOptions(): DiscoveryPlanOptions {
  const discoveryPlanOptions: DiscoveryPlanOptions = {
    projectRoot: process.cwd(),
    platform: process.platform,
  };

  if (process.env.HOME) {
    discoveryPlanOptions.homeDir = process.env.HOME;
  }
  if (process.env.XDG_CONFIG_HOME) {
    discoveryPlanOptions.xdgConfigHome = process.env.XDG_CONFIG_HOME;
  }

  return discoveryPlanOptions;
}

export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}
