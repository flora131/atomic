import { test, expect, describe } from "bun:test";
import { join } from "path";

/**
 * Tests for install.ps1 clean data directory behavior.
 *
 * These tests verify that install.ps1 removes the data directory before
 * extracting new config files, preventing stale artifacts from persisting.
 *
 * Since PowerShell is not available on all platforms, we verify the script
 * structure contains the correct commands in the correct order.
 */
describe("install.ps1 clean data directory", () => {
  test("install.ps1 contains Remove-Item before Expand-Archive", async () => {
    const installScript = await Bun.file(join(__dirname, "../install.ps1")).text();

    // Find the extraction section (handle both LF and CRLF line endings)
    const extractionSection = installScript.match(
      /# Extract config files to data directory.*?\r?\n([\s\S]*?)# Verify installation/
    );

    expect(extractionSection).not.toBeNull();
    const section = extractionSection![1]!;

    // Verify Remove-Item is present
    const removeItemIndex = section.indexOf("Remove-Item -Recurse -Force $DataDir");
    expect(removeItemIndex).toBeGreaterThan(-1);

    // Verify New-Item is present
    const newItemIndex = section.indexOf("New-Item -ItemType Directory -Force -Path $DataDir");
    expect(newItemIndex).toBeGreaterThan(-1);

    // Verify Expand-Archive is present
    const expandArchiveIndex = section.indexOf("Expand-Archive");
    expect(expandArchiveIndex).toBeGreaterThan(-1);

    // Verify correct order: Remove-Item < New-Item < Expand-Archive
    expect(removeItemIndex).toBeLessThan(newItemIndex);
    expect(newItemIndex).toBeLessThan(expandArchiveIndex);
  });

  test("install.ps1 guards Remove-Item with Test-Path check", async () => {
    const installScript = await Bun.file(join(__dirname, "../install.ps1")).text();

    // The Remove-Item should be guarded by a Test-Path check
    // to avoid errors on first install when directory doesn't exist
    expect(installScript).toContain("if (Test-Path $DataDir) { Remove-Item -Recurse -Force $DataDir }");
  });

  test("install.ps1 uses $null assignment for New-Item to suppress output", async () => {
    const installScript = await Bun.file(join(__dirname, "../install.ps1")).text();

    // New-Item should be assigned to $null to suppress console output
    expect(installScript).toContain("$null = New-Item -ItemType Directory -Force -Path $DataDir");
  });

  test("install.ps1 comment indicates clean install behavior", async () => {
    const installScript = await Bun.file(join(__dirname, "../install.ps1")).text();

    expect(installScript).toContain("# Extract config files to data directory (clean install)");
  });
});
