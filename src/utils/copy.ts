/**
 * Utilities for copying directories and files with exclusions
 */

import { readdir, mkdir, stat, realpath } from "fs/promises";
import { join, basename, extname, relative, resolve, sep } from "path";
import { getOppositeScriptExtension } from "./detect";

/**
 * Check if a target path is safe (doesn't escape the base directory)
 * Protects against path traversal attacks
 */
export function isPathSafe(basePath: string, targetPath: string): boolean {
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(basePath, targetPath);
  const rel = relative(resolvedBase, resolvedTarget);
  return !rel.startsWith("..") && !rel.includes(`..${sep}`);
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
async function copySymlinkAsFile(src: string, dest: string): Promise<void> {
  try {
    // Resolve the symlink to get the actual file path
    const resolvedPath = await realpath(src);
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
 * @throws Error if the copy operation fails or path traversal is detected
 */
export async function copyDir(
  src: string,
  dest: string,
  options: CopyOptions = {},
  rootSrc?: string
): Promise<void> {
  try {
    const { exclude = [], skipOppositeScripts = true } = options;
    const root = rootSrc ?? src;

    // Create destination directory
    await mkdir(dest, { recursive: true });

    // Read source directory entries
    const entries = await readdir(src, { withFileTypes: true });

    // Get the opposite script extension for filtering
    const oppositeExt = getOppositeScriptExtension();

    // Process entries in parallel for better performance
    const copyPromises: Promise<void>[] = [];

    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      // Validate destination path doesn't escape the target directory
      if (!isPathSafe(dest, entry.name)) {
        throw new Error(
          `Path traversal detected: ${entry.name} would escape destination directory`
        );
      }

      // Calculate relative path from root using path.relative for cross-platform support
      const relativePath = relative(root, srcPath);

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
        copyPromises.push(copyDir(srcPath, destPath, options, root));
      } else if (entry.isFile()) {
        copyPromises.push(copyFile(srcPath, destPath));
      } else if (entry.isSymbolicLink()) {
        // Dereference symlinks: resolve target and copy as regular file
        // This handles cases like AGENTS.md -> CLAUDE.md on Windows
        copyPromises.push(copySymlinkAsFile(srcPath, destPath));
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
