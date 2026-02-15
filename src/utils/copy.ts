/**
 * Utilities for copying directories and files with exclusions
 */

import { readdir, mkdir, stat, realpath, readFile } from "fs/promises";
import { join, extname, relative, resolve, sep } from "path";
import { getOppositeScriptExtension } from "./detect";

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
