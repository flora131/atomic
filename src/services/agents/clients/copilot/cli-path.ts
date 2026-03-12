import { delimiter, dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface CopilotCliPathResolverDependencies {
  pathExists?: (path: string) => Promise<boolean>;
  resolveImport?: (specifier: string, parent?: string) => string;
  which?: (command: string) => string | null | undefined;
  pathEnv?: string | undefined;
}

export function resolveNodePath(): string | undefined {
  return Bun.which("node") ?? undefined;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    return await Bun.file(path).exists();
  } catch {
    return false;
  }
}

function isNodeModulesBinPath(path: string): boolean {
  return path.includes(`${sep}node_modules${sep}.bin${sep}`) ||
    path.endsWith(`${sep}node_modules${sep}.bin`) ||
    path.includes("/node_modules/.bin/") ||
    path.endsWith("/node_modules/.bin") ||
    path.includes("\\node_modules\\.bin\\") ||
    path.endsWith("\\node_modules\\.bin");
}

async function findExternalCopilotBinaryOnPath(
  pathEnv: string | undefined,
  fileExists: (path: string) => Promise<boolean>,
): Promise<string | undefined> {
  if (!pathEnv) {
    return undefined;
  }

  const pathEntries = pathEnv
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !isNodeModulesBinPath(entry));

  const candidateNames = process.platform === "win32"
    ? ["copilot.exe", "copilot.cmd", "copilot.bat", "copilot"]
    : ["copilot"];

  for (const dir of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = join(dir, candidateName);
      if (await fileExists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return undefined;
}

export function resolveCopilotSdkCliLaunch(
  copilotCliPath: string,
  initialCliArgs: readonly string[] = [],
): { cliPath: string; cliArgs: string[] } {
  const cliArgs = initialCliArgs.includes("--experimental")
    ? [...initialCliArgs]
    : ["--experimental", ...initialCliArgs];
  const nodePath = resolveNodePath();

  if (nodePath && copilotCliPath.endsWith(".js")) {
    return {
      cliPath: nodePath,
      cliArgs: ["--no-warnings", copilotCliPath, ...cliArgs],
    };
  }

  if (!copilotCliPath.endsWith(".js") && process.platform !== "win32") {
    const bashPath = Bun.which("bash");
    if (bashPath) {
      const compatScript =
        'target="$1"; shift; filtered_args=(); for arg in "$@"; do if [[ "$arg" == "--no-auto-update" ]]; then continue; elif [[ "$arg" == "--headless" ]]; then filtered_args+=("--server"); else filtered_args+=("$arg"); fi; done; exec "$target" "${filtered_args[@]}"';
      return {
        cliPath: bashPath,
        cliArgs: [
          "-lc",
          compatScript,
          "atomic-copilot-compat",
          copilotCliPath,
          ...cliArgs,
        ],
      };
    }
  }

  return { cliPath: copilotCliPath, cliArgs };
}

export async function getBundledCopilotCliPath(
  dependencies: CopilotCliPathResolverDependencies = {},
): Promise<string> {
  const resolveImport =
    dependencies.resolveImport ?? import.meta.resolve.bind(import.meta);
  const fileExists = dependencies.pathExists ?? pathExists;
  const which = dependencies.which ?? Bun.which;
  const pathEnv = dependencies.pathEnv ?? process.env.PATH;

  try {
    const copilotBin = which("copilot");
    if (copilotBin && !isNodeModulesBinPath(copilotBin)) {
      const pkgDir = dirname(copilotBin);
      const indexPath = join(pkgDir, "index.js");
      if (await fileExists(indexPath)) {
        return indexPath;
      }
      if (await fileExists(copilotBin)) {
        return copilotBin;
      }
    }

    const externalCopilotBin = await findExternalCopilotBinaryOnPath(
      pathEnv,
      fileExists,
    );
    if (externalCopilotBin) {
      const pkgDir = dirname(externalCopilotBin);
      const indexPath = join(pkgDir, "index.js");
      if (await fileExists(indexPath)) {
        return indexPath;
      }
      if (await fileExists(externalCopilotBin)) {
        return externalCopilotBin;
      }
    }
  } catch {
    // Falls through to package resolution.
  }

  try {
    const sdkUrl = resolveImport("@github/copilot/sdk");
    const sdkPath = fileURLToPath(sdkUrl);
    const indexPath = join(dirname(dirname(sdkPath)), "index.js");
    if (await fileExists(indexPath)) {
      return indexPath;
    }
  } catch {
    // Falls through to nested package resolution.
  }

  try {
    const copilotSdkUrl = resolveImport("@github/copilot-sdk");
    const copilotPkgUrl = resolveImport("@github/copilot/sdk", copilotSdkUrl);
    const copilotPkgPath = fileURLToPath(copilotPkgUrl);
    const indexPath = join(dirname(dirname(copilotPkgPath)), "index.js");
    if (await fileExists(indexPath)) {
      return indexPath;
    }
  } catch {
    // Falls through to terminal error.
  }

  throw new Error(
    "Cannot find @github/copilot CLI.\n\n" +
      "Install the Copilot CLI using one of:\n" +
      "  brew install copilot-cli          # macOS/Linux\n" +
      "  npm install -g @github/copilot    # macOS/Linux/Windows\n" +
      "  winget install GitHub.Copilot     # Windows\n" +
      "  curl -fsSL https://gh.io/copilot-install | bash  # macOS/Linux\n\n" +
      "Or set a custom cliPath in CopilotClientOptions.",
  );
}
