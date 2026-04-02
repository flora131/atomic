import { join } from "path";

import { runCommand, prependPath, getBunBinDir, resolveBunExecutable } from "@/lib/spawn.ts";

const PLAYWRIGHT_CLI_PACKAGE = "@playwright/cli@latest";

async function installBunIfMissing(): Promise<void> {
  if (resolveBunExecutable()) {
    return;
  }

  if (process.platform === "win32") {
    const powerShellPath = Bun.which("powershell") ?? Bun.which("pwsh");
    if (!powerShellPath) {
      return;
    }
    await runCommand([
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
    await runCommand([shell, "-lc", "curl -fsSL https://bun.sh/install | bash"]);
  }

  const bunBinDir = getBunBinDir();
  if (bunBinDir) {
    prependPath(bunBinDir);
  }
}

async function installNpmIfMissing(): Promise<void> {
  if (Bun.which("npm")) {
    return;
  }

  if (process.platform === "win32") {
    if (Bun.which("winget")) {
      await runCommand([
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
      await runCommand(["choco", "install", "nodejs-lts", "-y", "--no-progress"]);
    } else if (Bun.which("scoop")) {
      await runCommand(["scoop", "install", "nodejs-lts"]);
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
    await runCommand([shell, "-lc", script]);
  }
}

export async function ensurePlaywrightPackageManagers(): Promise<void> {
  await installBunIfMissing();
  await installNpmIfMissing();
}

export async function installPlaywrightCli(): Promise<void> {
  const failures: string[] = [];

  const bunPath = resolveBunExecutable();
  if (bunPath) {
    const bunInstall = await runCommand([bunPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE]);
    if (bunInstall.success) {
      return;
    }
    failures.push(`bun: ${bunInstall.details || "No output."}`);
  }

  const npmPath = Bun.which("npm");
  if (npmPath) {
    const npmInstall = await runCommand([npmPath, "install", "-g", PLAYWRIGHT_CLI_PACKAGE]);
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
