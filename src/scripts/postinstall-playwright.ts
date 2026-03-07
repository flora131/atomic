import { mkdir } from "fs/promises";
import { join } from "path";

import { AGENT_CONFIG, type AgentKey } from "@/services/config/index.ts";
import {
  getAtomicGlobalAgentFolder,
  getAtomicHomeDir,
  getTemplateAgentFolder,
} from "@/services/config/atomic-global-config.ts";
import { copyFile, pathExists } from "@/services/system/copy.ts";

const PLAYWRIGHT_SKILL_RELATIVE_PATH = join("skills", "playwright-cli", "SKILL.md");
const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli@latest";

function decodeSpawnOutput(output: Uint8Array): string {
  return new TextDecoder().decode(output).trim();
}

function runInstallCommand(cmd: string[]): { success: boolean; details: string } {
  try {
    const result = Bun.spawnSync({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = decodeSpawnOutput(result.stderr);
    const stdout = decodeSpawnOutput(result.stdout);
    return {
      success: result.success,
      details: stderr.length > 0 ? stderr : stdout,
    };
  } catch (error) {
    return {
      success: false,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function prependPath(directory: string): void {
  const pathDelimiter = process.platform === "win32" ? ";" : ":";
  const currentPath = process.env.PATH ?? "";
  const entries = currentPath.split(pathDelimiter);
  if (!entries.includes(directory)) {
    process.env.PATH = directory + pathDelimiter + currentPath;
  }
}

function installBunIfMissing(): void {
  if (Bun.which("bun")) {
    return;
  }

  if (process.platform === "win32") {
    const powerShellPath = Bun.which("powershell") ?? Bun.which("pwsh");
    if (!powerShellPath) {
      return;
    }
    runInstallCommand([
      powerShellPath,
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Invoke-RestMethod https://bun.sh/install.ps1 | Invoke-Expression",
    ]);
  } else {
    const shell = Bun.which("bash") ?? Bun.which("sh");
    if (!shell) {
      return;
    }
    runInstallCommand([shell, "-lc", "curl -fsSL https://bun.sh/install | bash"]);
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (homeDir) {
    prependPath(join(homeDir, ".bun", "bin"));
  }
}

function installNpmIfMissing(): void {
  if (Bun.which("npm")) {
    return;
  }

  if (process.platform === "win32") {
    if (Bun.which("winget")) {
      runInstallCommand([
        "winget",
        "install",
        "--id",
        "OpenJS.NodeJS.LTS",
        "-e",
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ]);
    } else if (Bun.which("choco")) {
      runInstallCommand(["choco", "install", "nodejs-lts", "-y", "--no-progress"]);
    } else if (Bun.which("scoop")) {
      runInstallCommand(["scoop", "install", "nodejs-lts"]);
    }

    const programFiles = process.env.ProgramFiles;
    if (programFiles) {
      prependPath(join(programFiles, "nodejs"));
    }
    return;
  }

  const shell = Bun.which("bash") ?? Bun.which("sh");
  if (!shell) {
    return;
  }
  const installers = [
    "if command -v brew >/dev/null 2>&1; then brew install node; fi",
    "if command -v apt-get >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then apt-get update && apt-get install -y nodejs npm; fi; fi",
    "if command -v dnf >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo dnf install -y nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then dnf install -y nodejs npm; fi; fi",
    "if command -v yum >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo yum install -y nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then yum install -y nodejs npm; fi; fi",
    "if command -v pacman >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo pacman -Sy --noconfirm nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then pacman -Sy --noconfirm nodejs npm; fi; fi",
    "if command -v zypper >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo zypper --non-interactive install nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then zypper --non-interactive install nodejs npm; fi; fi",
    "if command -v apk >/dev/null 2>&1; then if command -v sudo >/dev/null 2>&1; then sudo apk add --no-cache nodejs npm; elif [ \"$(id -u)\" -eq 0 ]; then apk add --no-cache nodejs npm; fi; fi",
  ];

  for (const script of installers) {
    if (Bun.which("npm")) {
      return;
    }
    runInstallCommand([shell, "-lc", script]);
  }
}

export function ensurePlaywrightPackageManagers(): void {
  installBunIfMissing();
  installNpmIfMissing();
}

export async function installPlaywrightCli(): Promise<void> {
  const failures: string[] = [];

  const bunPath = Bun.which("bun");
  if (bunPath) {
    const bunInstall = runInstallCommand([bunPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE]);
    if (bunInstall.success) {
      return;
    }
    failures.push(`bun: ${bunInstall.details || "No output."}`);
  }

  const npmPath = Bun.which("npm");
  if (npmPath) {
    const npmInstall = runInstallCommand([npmPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE]);
    if (npmInstall.success) {
      return;
    }
    failures.push(`npm: ${npmInstall.details || "No output."}`);
  }

  if (failures.length === 0) {
    throw new Error("Neither bun nor npm is available to install @playwright/cli.");
  }

  throw new Error(`Failed to install ${PLAYWRIGHT_CLI_PACKAGE}: ${failures.join(" | ")}`);
}

export async function deployPlaywrightSkill(
  configRoot: string,
  atomicHomeDir: string = getAtomicHomeDir()
): Promise<void> {
  const agentKeys = Object.keys(AGENT_CONFIG) as AgentKey[];
  const missingSkillTemplates: string[] = [];

  for (const agentKey of agentKeys) {
    const sourceSkillPath = join(
      configRoot,
      getTemplateAgentFolder(agentKey),
      PLAYWRIGHT_SKILL_RELATIVE_PATH
    );

    if (!(await pathExists(sourceSkillPath))) {
      missingSkillTemplates.push(sourceSkillPath);
      continue;
    }

    const destinationAgentFolder = join(atomicHomeDir, getAtomicGlobalAgentFolder(agentKey));
    const destinationSkillDir = join(destinationAgentFolder, "skills", "playwright-cli");
    await mkdir(destinationSkillDir, { recursive: true });

    const destinationSkillPath = join(destinationSkillDir, "SKILL.md");
    await copyFile(sourceSkillPath, destinationSkillPath);
  }

  if (missingSkillTemplates.length > 0) {
    throw new Error(
      `Missing Playwright skill template(s): ${missingSkillTemplates.join(", ")}`
    );
  }
}
