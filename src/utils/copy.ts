/**
 * Utilities for copying directories and files with exclusions
 */

import { readdir, mkdir, stat } from "fs/promises";
import { join, basename, extname } from "path";
import { getOppositeScriptExtension } from "./detect";

interface CopyOptions {
  /** Paths to exclude (relative to source root or base names) */
  exclude?: string[];
  /** Whether to skip scripts for the opposite platform */
  skipOppositeScripts?: boolean;
}

/**
 * Copy a single file using Bun's file API
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  const srcFile = Bun.file(src);
  await Bun.write(dest, srcFile);
}

/**
 * Check if a path should be excluded based on exclusion rules
 */
function shouldExclude(
  relativePath: string,
  name: string,
  exclude: string[]
): boolean {
  // Check if the name matches any exclusion
  if (exclude.includes(name)) {
    return true;
  }

  // Check if the relative path starts with any exclusion
  for (const ex of exclude) {
    if (relativePath === ex || relativePath.startsWith(`${ex}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively copy a directory with exclusions
 *
 * @param src Source directory path
 * @param dest Destination directory path
 * @param options Copy options including exclusions
 * @param rootSrc Root source path for calculating relative paths (used internally)
 */
export async function copyDir(
  src: string,
  dest: string,
  options: CopyOptions = {},
  rootSrc?: string
): Promise<void> {
  const { exclude = [], skipOppositeScripts = true } = options;
  const root = rootSrc ?? src;

  // Create destination directory
  await mkdir(dest, { recursive: true });

  // Read source directory entries
  const entries = await readdir(src, { withFileTypes: true });

  // Get the opposite script extension for filtering
  const oppositeExt = getOppositeScriptExtension();

  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    // Calculate relative path from root
    const relativePath = srcPath.slice(root.length + 1);

    // Check if this path should be excluded
    if (shouldExclude(relativePath, entry.name, exclude)) {
      continue;
    }

    // Skip scripts for the opposite platform
    if (skipOppositeScripts && extname(entry.name) === oppositeExt) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, options, root);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
    // Skip symlinks and other special files
  }
}

/**
 * Check if a path exists
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
