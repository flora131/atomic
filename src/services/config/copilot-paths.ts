import { homedir } from "os";
import { join, resolve } from "path";
import {
  emitDiscoveryEvent,
  isDiscoveryDebugLoggingEnabled,
} from "@/services/config/discovery-events.ts";
import { resolveDefaultConfigHome } from "@/services/config/provider-discovery-plan.ts";

export const COPILOT_CANONICAL_USER_ROOT_ID = "copilot_user_canonical_native";
export const COPILOT_HOME_USER_ROOT_ID = "copilot_user_home_native";

export type CopilotUserRootId =
  | typeof COPILOT_CANONICAL_USER_ROOT_ID
  | typeof COPILOT_HOME_USER_ROOT_ID;

export interface CopilotPathConflictWarning {
  code: "copilot_user_root_conflict";
  canonicalRoot: string;
  fallbackRoot: string;
  message: string;
}

export interface ResolveCopilotUserRootsOptions {
  homeDir?: string;
  xdgConfigHome?: string | null;
  appDataDir?: string | null;
  platform?: NodeJS.Platform;
}

export interface CopilotUserRootsResolution {
  canonicalRoot: string;
  homeRoot: string;
  rootsById: Record<CopilotUserRootId, string>;
  rootsInPrecedenceOrder: readonly [string, string];
  warnings: readonly CopilotPathConflictWarning[];
}

export type CopilotPathWarningHandler = (
  warning: CopilotPathConflictWarning,
) => void;

function normalizeOptionalPath(pathValue: string | null | undefined): string | null {
  if (typeof pathValue !== "string") {
    return null;
  }

  const trimmed = pathValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveCopilotCanonicalUserRoot(
  homeDir: string,
  options: {
    xdgConfigHome?: string | null;
    appDataDir?: string | null;
    platform?: NodeJS.Platform;
  } = {},
): string {
  const normalizedXdgConfigHome = normalizeOptionalPath(options.xdgConfigHome);
  const normalizedAppDataDir = normalizeOptionalPath(options.appDataDir);

  const configHome = resolveDefaultConfigHome({
    homeDir: resolve(homeDir),
    xdgConfigHome:
      options.xdgConfigHome === undefined
        ? undefined
        : normalizedXdgConfigHome,
    appDataDir:
      options.appDataDir === undefined
        ? undefined
        : normalizedAppDataDir,
    platform: options.platform,
  });

  return join(configHome, ".copilot");
}

export async function resolveCopilotUserRoots(
  options: ResolveCopilotUserRootsOptions = {},
): Promise<CopilotUserRootsResolution> {
  const homeDir = options.homeDir ?? homedir();
  const xdgConfigHome = normalizeOptionalPath(
    options.xdgConfigHome === undefined
      ? process.env.XDG_CONFIG_HOME
      : options.xdgConfigHome,
  );
  const appDataDir = normalizeOptionalPath(
    options.appDataDir === undefined
      ? process.env.APPDATA
      : options.appDataDir,
  );

  const canonicalRoot = resolveCopilotCanonicalUserRoot(homeDir, {
    xdgConfigHome,
    appDataDir,
    platform: options.platform,
  });
  const homeRoot = join(resolve(homeDir), ".copilot");

  return {
    canonicalRoot,
    homeRoot,
    rootsById: {
      [COPILOT_CANONICAL_USER_ROOT_ID]: canonicalRoot,
      [COPILOT_HOME_USER_ROOT_ID]: homeRoot,
    },
    rootsInPrecedenceOrder: [canonicalRoot, homeRoot],
    warnings: [],
  };
}

export function emitCopilotPathConflictWarnings(
  warnings: readonly CopilotPathConflictWarning[],
  onWarning?: CopilotPathWarningHandler,
): void {
  for (const warning of warnings) {
    emitDiscoveryEvent("discovery.path.conflict", {
      level: "warn",
      tags: {
        provider: "copilot",
        path: resolve(warning.canonicalRoot),
        rootId: COPILOT_CANONICAL_USER_ROOT_ID,
        rootTier: "userGlobal",
        rootCompatibility: "native",
      },
      data: {
        code: warning.code,
        canonicalRoot: resolve(warning.canonicalRoot),
        fallbackRoot: resolve(warning.fallbackRoot),
      },
    });

    if (onWarning) {
      onWarning(warning);
      continue;
    }

    if (isDiscoveryDebugLoggingEnabled()) {
      console.warn(warning.message);
    }
  }
}
