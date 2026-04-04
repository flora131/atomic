/**
 * Tests for install.sh Windows delegation logic.
 *
 * Verifies that the install.sh script correctly builds PowerShell arguments
 * when delegating to install.ps1 on Windows (mingw/msys/cygwin environments).
 *
 * Since we cannot easily simulate a Windows uname on macOS/Linux, we extract
 * the argument-building logic into an isolated bash snippet and verify its output.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const INSTALL_SH_PATH = join(import.meta.dir, "../../install.sh");

describe("install.sh Windows delegation", () => {
  test("install.sh has valid bash syntax", async () => {
    const result = Bun.spawnSync(["bash", "-n", INSTALL_SH_PATH]);
    expect(result.exitCode).toBe(0);
  });

  test("installers preserve existing Atomic data instead of deleting the data directory", () => {
    const shContent = readFileSync(INSTALL_SH_PATH, "utf-8");
    const psContent = readFileSync(join(import.meta.dir, "../../install.ps1"), "utf-8");

    expect(shContent).not.toContain('rm -rf "$DATA_DIR"');
    expect(psContent).not.toContain("Remove-Item -Recurse -Force $DataDir");
    expect(shContent).toContain('tar -xzf "${tmp_dir}/${BINARY_NAME}-config.tar.gz" -C "$DATA_DIR"');
    expect(psContent).toContain("Expand-Archive -Path $TempConfig -DestinationPath $DataDir -Force");
  });

  test("install.sh contains Windows delegation block in main()", () => {
    const content = readFileSync(INSTALL_SH_PATH, "utf-8");
    // Must have the Windows case pattern in main()
    expect(content).toContain("mingw*|msys*|cygwin*)");
    // Must build ps_args
    expect(content).toContain('local ps_args=""');
    // Must check ATOMIC_INSTALL_VERSION
    expect(content).toContain("ATOMIC_INSTALL_VERSION");
    // Must check ATOMIC_INSTALL_PRERELEASE
    expect(content).toContain("ATOMIC_INSTALL_PRERELEASE");
    // Must pass -Version flag
    expect(content).toContain("-Version");
    // Must pass -Prerelease flag
    expect(content).toContain("-Prerelease");
  });

  test("install.sh exports ATOMIC_INSTALL_VERSION and ATOMIC_INSTALL_PRERELEASE before delegation", () => {
    const content = readFileSync(INSTALL_SH_PATH, "utf-8");
    const lines = content.split("\n");

    // Find the export lines
    let exportVersionLine = -1;
    let exportPrereleaseLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.includes('export ATOMIC_INSTALL_VERSION=')) {
        exportVersionLine = i;
      }
      if (line.includes('export ATOMIC_INSTALL_PRERELEASE=')) {
        exportPrereleaseLine = i;
      }
    }

    expect(exportVersionLine).toBeGreaterThan(-1);
    expect(exportPrereleaseLine).toBeGreaterThan(-1);

    // Find the Windows delegation block in main() by looking for the
    // pwsh invocation with ps_args (unique to main's delegation block)
    let delegationPowershellLine = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.includes("pwsh") && line.includes("ps_args")) {
        delegationPowershellLine = i;
        break;
      }
    }

    expect(delegationPowershellLine).toBeGreaterThan(-1);

    // Exports must come before the delegation powershell invocation
    expect(exportVersionLine).toBeLessThan(delegationPowershellLine);
    expect(exportPrereleaseLine).toBeLessThan(delegationPowershellLine);
  });

  test("install.sh validates semver format before passing to PowerShell", () => {
    const content = readFileSync(INSTALL_SH_PATH, "utf-8");
    // Must have semver regex validation in the Windows delegation block
    expect(content).toContain(
      '^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[a-zA-Z0-9.]+)?$'
    );
  });

  test("ps_args construction produces correct output for version only", async () => {
    // Extract and test the ps_args building logic in isolation
    const script = `
      set -euo pipefail
      ATOMIC_INSTALL_VERSION="v1.2.3"
      ATOMIC_INSTALL_PRERELEASE="false"
      ps_args=""
      if [[ -n "\${ATOMIC_INSTALL_VERSION:-}" ]]; then
        if [[ ! "\${ATOMIC_INSTALL_VERSION}" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
          echo "INVALID_VERSION" && exit 1
        fi
        ps_args="\${ps_args} -Version '\${ATOMIC_INSTALL_VERSION}'"
      fi
      if [[ "\${ATOMIC_INSTALL_PRERELEASE:-}" == "true" ]]; then
        ps_args="\${ps_args} -Prerelease"
      fi
      echo "\${ps_args}"
    `;
    const result = Bun.spawnSync(["bash", "-c", script]);
    const output = result.stdout.toString().trim();
    expect(output).toBe("-Version 'v1.2.3'");
  });

  test("ps_args construction produces correct output for prerelease only", async () => {
    const script = `
      set -euo pipefail
      ATOMIC_INSTALL_VERSION=""
      ATOMIC_INSTALL_PRERELEASE="true"
      ps_args=""
      if [[ -n "\${ATOMIC_INSTALL_VERSION:-}" ]]; then
        ps_args="\${ps_args} -Version '\${ATOMIC_INSTALL_VERSION}'"
      fi
      if [[ "\${ATOMIC_INSTALL_PRERELEASE:-}" == "true" ]]; then
        ps_args="\${ps_args} -Prerelease"
      fi
      echo "\${ps_args}"
    `;
    const result = Bun.spawnSync(["bash", "-c", script]);
    const output = result.stdout.toString().trim();
    expect(output).toBe("-Prerelease");
  });

  test("ps_args construction produces correct output for version + prerelease", async () => {
    const script = `
      set -euo pipefail
      ATOMIC_INSTALL_VERSION="v1.2.3-1"
      ATOMIC_INSTALL_PRERELEASE="true"
      ps_args=""
      if [[ -n "\${ATOMIC_INSTALL_VERSION:-}" ]]; then
        if [[ ! "\${ATOMIC_INSTALL_VERSION}" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
          echo "INVALID_VERSION" && exit 1
        fi
        ps_args="\${ps_args} -Version '\${ATOMIC_INSTALL_VERSION}'"
      fi
      if [[ "\${ATOMIC_INSTALL_PRERELEASE:-}" == "true" ]]; then
        ps_args="\${ps_args} -Prerelease"
      fi
      echo "\${ps_args}"
    `;
    const result = Bun.spawnSync(["bash", "-c", script]);
    const output = result.stdout.toString().trim();
    expect(output).toBe("-Version 'v1.2.3-1' -Prerelease");
  });

  test("ps_args construction produces empty string when no version or prerelease", async () => {
    const script = `
      set -euo pipefail
      ATOMIC_INSTALL_VERSION=""
      ATOMIC_INSTALL_PRERELEASE="false"
      ps_args=""
      if [[ -n "\${ATOMIC_INSTALL_VERSION:-}" ]]; then
        ps_args="\${ps_args} -Version '\${ATOMIC_INSTALL_VERSION}'"
      fi
      if [[ "\${ATOMIC_INSTALL_PRERELEASE:-}" == "true" ]]; then
        ps_args="\${ps_args} -Prerelease"
      fi
      echo "\${ps_args}"
    `;
    const result = Bun.spawnSync(["bash", "-c", script]);
    const output = result.stdout.toString().trim();
    expect(output).toBe("");
  });

  test("semver validation rejects malicious input", async () => {
    const maliciousVersions = [
      "'; rm -rf /; echo '",
      "v1.2.3; whoami",
      "$(whoami)",
      "v1.2.3 && echo hacked",
      "../../../etc/passwd",
      "notaversion",
    ];

    for (const version of maliciousVersions) {
      const script = `
        set -euo pipefail
        ATOMIC_INSTALL_VERSION="${version.replace(/"/g, '\\"')}"
        if [[ -n "\${ATOMIC_INSTALL_VERSION:-}" ]]; then
          if [[ ! "\${ATOMIC_INSTALL_VERSION}" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
            echo "REJECTED"
            exit 0
          fi
          echo "ACCEPTED"
        fi
      `;
      const result = Bun.spawnSync(["bash", "-c", script]);
      const output = result.stdout.toString().trim();
      expect(output).toBe("REJECTED");
    }
  });

  test("semver validation accepts valid versions", async () => {
    const validVersions = [
      "v1.2.3",
      "1.2.3",
      "v0.4.29",
      "v1.0.0-1",
      "v1.0.0-alpha",
      "v0.4.29-0",
    ];

    for (const version of validVersions) {
      const script = `
        set -euo pipefail
        ATOMIC_INSTALL_VERSION="${version}"
        if [[ -n "\${ATOMIC_INSTALL_VERSION:-}" ]]; then
          if [[ ! "\${ATOMIC_INSTALL_VERSION}" =~ ^v?[0-9]+\\.[0-9]+\\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
            echo "REJECTED"
            exit 0
          fi
          echo "ACCEPTED"
        fi
      `;
      const result = Bun.spawnSync(["bash", "-c", script]);
      const output = result.stdout.toString().trim();
      expect(output).toBe("ACCEPTED");
    }
  });

  test("detect_platform() no longer has direct PowerShell delegation", () => {
    const content = readFileSync(INSTALL_SH_PATH, "utf-8");
    // The detect_platform function should NOT contain 'powershell -c "irm'
    // (the old delegation that didn't pass args)
    const detectPlatformMatch = content.match(
      /detect_platform\(\)\s*\{[\s\S]*?\n\}/
    );
    expect(detectPlatformMatch).not.toBeNull();
    const detectPlatformBody = detectPlatformMatch![0];
    // Should NOT have the old direct delegation
    expect(detectPlatformBody).not.toContain("irm https://raw.githubusercontent.com");
    // Should have an error message instead, indicating delegation moved to main()
    expect(detectPlatformBody).toContain("error");
  });
});
