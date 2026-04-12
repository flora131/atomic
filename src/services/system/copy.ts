/**
 * Utilities for copying directories and files with exclusions
 */

import { readdir, mkdir, stat, readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join, extname, relative, resolve } from "node:path";

/**
 * Safely create a directory (and parents) without throwing on EEXIST.
 *
 * `mkdir` with `{ recursive: true }` is supposed to be idempotent, but
 * cloud-sync tools like OneDrive can create the directory between the
 * internal existence check and the actual syscall, causing a spurious
 * EEXIST error on Windows.  This wrapper absorbs that race.
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return;
    }
    throw error;
  }
}

/**
 * Synchronous version of {@link ensureDir}.
 */
export function ensureDirSync(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      return;
    }
    throw error;
  }
}
import { getOppositeScriptExtension } from "@/services/system/detect.ts";
import {
  assertPathWithinRoot,
  assertRealPathWithinRoot,
  isPathWithinRoot,
} from "@/lib/path-root-guard.ts";

/**
 * Normalize a path for cross-platform comparison.
 * Converts Windows backslashes to forward slashes so that exclusion
 * patterns work consistently on both Windows and Unix systems.
 *
 * @param p - The path to normalize
 * @returns The path with all backslashes converted to forward slashes
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Check if a target path is safe (doesn't escape the base directory)
 * Protects against path traversal attacks
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedTarget = resolve(basePath, targetPath);
  return isPathWithinRoot(basePath, resolvedTarget);
}

interface CopyOptions {
  /** Paths to exclude (relative to source root or base names) */
  exclude?: string[];
  /** Whether to skip scripts for the opposite platform */
  skipOppositeScripts?: boolean;
}

/**
 * Copy a single file using Bun's file API
 * @throws Error if the copy operation fails
 */
export async function copyFile(src: string, dest: string): Promise<void> {
  if (resolve(src) === resolve(dest)) {
    return;
  }

  try {
    const srcFile = Bun.file(src);
    await Bun.write(dest, srcFile);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy ${src} to ${dest}: ${message}`);
  }
}

/**
 * Copy a symlink by dereferencing it (copying the target content as a regular file)
 * This ensures symlinks work on Windows without requiring special permissions
 * @throws Error if the copy operation fails
 */
async function copySymlinkAsFile(
  src: string,
  dest: string,
  sourceRoot: string,
): Promise<void> {
  try {
    // Resolve the symlink and ensure it cannot escape the source root
    const resolvedPath = await assertRealPathWithinRoot(
      sourceRoot,
      src,
      "Symlink source",
    );
    const stats = await stat(resolvedPath);

    if (stats.isFile()) {
      // Copy the target file content
      await copyFile(resolvedPath, dest);
    }
    // If symlink points to a directory, we skip it (rare case, could be handled if needed)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy symlink ${src} to ${dest}: ${message}`);
  }
}

async function copyFileWithOverwriteOption(
  src: string,
  dest: string,
  overwriteExisting: boolean,
): Promise<void> {
  if (!overwriteExisting && (await pathExists(dest))) {
    return;
  }

  await copyFile(src, dest);
}

async function copySymlinkAsFileWithOverwriteOption(
  src: string,
  dest: string,
  sourceRoot: string,
  overwriteExisting: boolean,
): Promise<void> {
  if (!overwriteExisting && (await pathExists(dest))) {
    return;
  }

  await copySymlinkAsFile(src, dest, sourceRoot);
}

/**
 * Check if a path should be excluded based on exclusion rules.
 * Uses normalized paths (forward slashes) to ensure consistent matching
 * on both Windows and Unix systems.
 */
export function shouldExclude(
  relativePath: string,
  name: string,
  exclude: string[]
): boolean {
  // Check if the name matches any exclusion
  if (exclude.includes(name)) {
    return true;
  }

  // Normalize the relative path for cross-platform comparison
  // This ensures Windows backslash paths match forward-slash exclusion patterns
  const normalizedPath = normalizePath(relativePath);

  // Check if the relative path starts with any exclusion
  for (const ex of exclude) {
    const normalizedExclusion = normalizePath(ex);
    if (
      normalizedPath === normalizedExclusion ||
      normalizedPath.startsWith(`${normalizedExclusion}/`)
    ) {
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
 * @throws Error if the copy operation fails or path traversal is detected
 */
async function copyDirInternal(
  src: string,
  dest: string,
  options: CopyOptions = {},
  rootSrc?: string,
  rootDest?: string,
  overwriteExisting: boolean = true,
): Promise<void> {
  try {
    const { exclude = [], skipOppositeScripts = true } = options;
    const root = rootSrc ?? src;
    const destinationRoot = rootDest ?? dest;

    assertPathWithinRoot(root, src, "Source path");
    assertPathWithinRoot(destinationRoot, dest, "Destination path");

    await assertRealPathWithinRoot(root, src, "Source path");

    // Create destination directory
    await ensureDir(dest);

    // Read source directory entries
    const entries = await readdir(src, { withFileTypes: true });

    // Get the opposite script extension for filtering
    const oppositeExt = getOppositeScriptExtension();

    // Process entries in parallel for better performance
    const copyPromises: Promise<void>[] = [];

    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      assertPathWithinRoot(root, srcPath, "Source entry path");
      assertPathWithinRoot(destinationRoot, destPath, "Destination entry path");

      if (!isPathSafe(src, entry.name) || !isPathSafe(dest, entry.name)) {
        throw new Error(`Path traversal detected: ${entry.name}`);
      }

      // Calculate relative path from root using path.relative for cross-platform support
      const relativePath = relative(root, srcPath);

      if (relativePath.startsWith("..")) {
        throw new Error(`Path traversal detected: ${srcPath}`);
      }

      // Check if this path should be excluded
      if (shouldExclude(relativePath, entry.name, exclude)) {
        continue;
      }

      // Skip scripts for the opposite platform
      if (skipOppositeScripts && extname(entry.name) === oppositeExt) {
        continue;
      }

      if (entry.isDirectory()) {
        // Directories are processed recursively (which will parallelize their contents)
        copyPromises.push(
          copyDirInternal(
            srcPath,
            destPath,
            options,
            root,
            destinationRoot,
            overwriteExisting,
          ),
        );
      } else if (entry.isFile()) {
        copyPromises.push(
          copyFileWithOverwriteOption(srcPath, destPath, overwriteExisting),
        );
      } else if (entry.isSymbolicLink()) {
        // Dereference symlinks: resolve target and copy as regular file
        copyPromises.push(
          copySymlinkAsFileWithOverwriteOption(
            srcPath,
            destPath,
            root,
            overwriteExisting,
          ),
        );
      }
      // Skip other special files (block devices, etc.)
    }

    // Wait for all copy operations to complete
    await Promise.all(copyPromises);
  } catch (error) {
    // Re-throw errors with more context if they don't already have it
    if (error instanceof Error && error.message.includes("Failed to copy")) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to copy directory ${src} to ${dest}: ${message}`);
  }
}

/**
 * Recursively copy a directory, overwriting existing destination files.
 */
export async function copyDir(
  src: string,
  dest: string,
  options: CopyOptions = {},
  rootSrc?: string,
  rootDest?: string,
): Promise<void> {
  await copyDirInternal(src, dest, options, rootSrc, rootDest, true);
}

/**
 * Recursively copy a directory without overwriting existing destination files.
 */
export async function copyDirNonDestructive(
  src: string,
  dest: string,
  options: CopyOptions = {},
  rootSrc?: string,
  rootDest?: string,
): Promise<void> {
  await copyDirInternal(src, dest, options, rootSrc, rootDest, false);
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

/**
 * Check if a file is empty or contains only whitespace.
 * 
 * A file is considered empty if:
 * - It does not exist (returns true to allow overwrite)
 * - It has 0 bytes
 * - It contains only whitespace characters (for files under 1KB)
 * 
 * @param path - The path to the file to check
 * @returns true if the file is empty or whitespace-only, false otherwise
 */
export async function isFileEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    
    // 0-byte files are empty
    if (stats.size === 0) {
      return true;
    }
    
    // For small files (under 1KB), check if content is whitespace-only
    if (stats.size < 1024) {
      const content = await readFile(path, "utf-8");
      return content.trim().length === 0;
    }
    
    // Large files with content are not empty
    return false;
  } catch {
    // If file doesn't exist or can't be read, treat as empty (allow overwrite)
    return true;
  }
}
