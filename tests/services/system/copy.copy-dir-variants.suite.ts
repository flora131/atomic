import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  copyDir,
  copyDirNonDestructive,
  existsSync,
  join,
  makeDirStructure,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  tmpdir,
  writeFile,
} from "./copy.test-support.ts";

describe("copyDirNonDestructive", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-dir-safe-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("copies missing files and preserves existing destination files", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");

    await makeDirStructure(srcDir, {
      "skills/shared/SKILL.md": "source shared",
      "skills/new/SKILL.md": "source new",
    });
    await makeDirStructure(destDir, {
      "skills/shared/SKILL.md": "destination shared",
    });

    await copyDirNonDestructive(srcDir, destDir);

    expect(await Bun.file(join(destDir, "skills/shared/SKILL.md")).text()).toBe(
      "destination shared",
    );
    expect(await Bun.file(join(destDir, "skills/new/SKILL.md")).text()).toBe(
      "source new",
    );
  });

  test("preserves existing symlink destination target files", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    const targetFile = join(srcDir, "target.txt");
    const symlinkFile = join(srcDir, "link.txt");
    const existingDest = join(destDir, "link.txt");

    await mkdir(srcDir, { recursive: true });
    await mkdir(destDir, { recursive: true });
    await writeFile(targetFile, "symlink target", "utf-8");
    await symlink(targetFile, symlinkFile);
    await writeFile(existingDest, "existing destination", "utf-8");

    await copyDirNonDestructive(srcDir, destDir);

    expect(await Bun.file(existingDest).text()).toBe("existing destination");
  });
});

describe("copyDir with skipOppositeScripts", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "atomic-copy-scripts-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("should skip opposite platform scripts by default", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "script.sh": "shell script",
      "script.ps1": "powershell script",
    });

    await copyDir(srcDir, destDir);

    const isWin = process.platform === "win32";
    expect(existsSync(join(destDir, "script.sh"))).toBe(!isWin);
    expect(existsSync(join(destDir, "script.ps1"))).toBe(isWin);
  });

  test("should include all scripts when skipOppositeScripts is false", async () => {
    const srcDir = join(tempDir, "src");
    const destDir = join(tempDir, "dest");
    await makeDirStructure(srcDir, {
      "script.sh": "shell script",
      "script.ps1": "powershell script",
    });

    await copyDir(srcDir, destDir, { skipOppositeScripts: false });

    expect(existsSync(join(destDir, "script.sh"))).toBe(true);
    expect(existsSync(join(destDir, "script.ps1"))).toBe(true);
  });
});
