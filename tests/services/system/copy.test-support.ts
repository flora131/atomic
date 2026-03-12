import { existsSync } from "fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import {
  copyDir,
  copyDirNonDestructive,
  copyFile,
  isDirectory,
  isFileEmpty,
  isPathSafe,
  normalizePath,
  pathExists,
  shouldExclude,
} from "@/services/system/copy.ts";

export {
  copyDir,
  copyDirNonDestructive,
  copyFile,
  existsSync,
  isDirectory,
  isFileEmpty,
  isPathSafe,
  join,
  mkdir,
  mkdtemp,
  normalizePath,
  pathExists,
  resolve,
  rm,
  shouldExclude,
  symlink,
  tmpdir,
  writeFile,
};

export async function makeFile(path: string, content = "test"): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf-8");
}

export async function makeDirStructure(
  baseDir: string,
  structure: Record<string, string>,
): Promise<void> {
  for (const [relativePath, content] of Object.entries(structure)) {
    await makeFile(join(baseDir, relativePath), content);
  }
}
