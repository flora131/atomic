/**
 * Filesystem mock utilities for tests that read/write config files.
 *
 * Usage:
 *   import { mockFS, resetFS } from "tests/test-support/mocks/fs.ts";
 *
 *   mockFS({
 *     "/home/user/.config/atomic/settings.json": '{ "theme": "dark" }',
 *     "/project/.claude/config.json": '{ "model": "opus" }',
 *   });
 *
 *   // ... run tests that import from 'node:fs/promises' or 'node:fs' ...
 *
 *   resetFS(); // restore original fs behaviour
 */

import { mock } from "bun:test";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Virtual filesystem state
// ---------------------------------------------------------------------------

/** In-memory file tree. Keys are absolute POSIX paths, values are file contents. */
let virtualFiles: Map<string, string> = new Map();

/** Set of directories that have been explicitly created via mkdir. */
let virtualDirs: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  return path.resolve(p);
}

/** Derive all ancestor directories so `stat("/a/b/c")` works after writing `/a/b/c/d.txt`. */
function inferDirectories(): Set<string> {
  const dirs = new Set<string>(virtualDirs);
  for (const filePath of virtualFiles.keys()) {
    let current = path.dirname(filePath);
    while (current !== "/" && current !== ".") {
      dirs.add(current);
      current = path.dirname(current);
    }
    dirs.add("/");
  }
  return dirs;
}

function fileNotFoundError(filePath: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  err.errno = -2;
  err.syscall = "open";
  err.path = filePath;
  return err;
}

function fileExistsError(filePath: string): NodeJS.ErrnoException {
  const err = new Error(`EEXIST: file already exists, mkdir '${filePath}'`) as NodeJS.ErrnoException;
  err.code = "EEXIST";
  err.errno = -17;
  err.syscall = "mkdir";
  err.path = filePath;
  return err;
}

function notADirectoryError(filePath: string): NodeJS.ErrnoException {
  const err = new Error(`ENOTDIR: not a directory, scandir '${filePath}'`) as NodeJS.ErrnoException;
  err.code = "ENOTDIR";
  err.errno = -20;
  err.syscall = "scandir";
  err.path = filePath;
  return err;
}

// ---------------------------------------------------------------------------
// Mock implementation of fs/promises
// ---------------------------------------------------------------------------

function buildMockFsPromises() {
  return {
    readFile: mock(async (filePath: string, _options?: unknown) => {
      const resolved = normalizePath(filePath);
      const content = virtualFiles.get(resolved);
      if (content === undefined) {
        throw fileNotFoundError(resolved);
      }
      return content;
    }),

    writeFile: mock(async (filePath: string, data: string, _options?: unknown) => {
      const resolved = normalizePath(filePath);
      virtualFiles.set(resolved, data);
    }),

    readdir: mock(async (dirPath: string, _options?: unknown) => {
      const resolved = normalizePath(dirPath);
      const allDirs = inferDirectories();

      if (!allDirs.has(resolved)) {
        if (virtualFiles.has(resolved)) {
          throw notADirectoryError(resolved);
        }
        throw fileNotFoundError(resolved);
      }

      const entries: string[] = [];
      const prefix = resolved.endsWith("/") ? resolved : resolved + "/";

      for (const filePath of virtualFiles.keys()) {
        if (filePath.startsWith(prefix)) {
          const relative = filePath.slice(prefix.length);
          const firstSegment = relative.split("/")[0];
          if (firstSegment && !entries.includes(firstSegment)) {
            entries.push(firstSegment);
          }
        }
      }

      // Also include subdirectories that exist in virtualDirs
      for (const dirEntry of allDirs) {
        if (dirEntry.startsWith(prefix)) {
          const relative = dirEntry.slice(prefix.length);
          const firstSegment = relative.split("/")[0];
          if (firstSegment && !entries.includes(firstSegment)) {
            entries.push(firstSegment);
          }
        }
      }

      return entries.sort();
    }),

    stat: mock(async (filePath: string) => {
      const resolved = normalizePath(filePath);
      const allDirs = inferDirectories();

      if (virtualFiles.has(resolved)) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: virtualFiles.get(resolved)!.length,
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          birthtime: new Date(),
          mode: 0o644,
        };
      }

      if (allDirs.has(resolved)) {
        return {
          isFile: () => false,
          isDirectory: () => true,
          size: 0,
          mtime: new Date(),
          atime: new Date(),
          ctime: new Date(),
          birthtime: new Date(),
          mode: 0o755,
        };
      }

      throw fileNotFoundError(resolved);
    }),

    access: mock(async (filePath: string) => {
      const resolved = normalizePath(filePath);
      const allDirs = inferDirectories();
      if (!virtualFiles.has(resolved) && !allDirs.has(resolved)) {
        throw fileNotFoundError(resolved);
      }
    }),

    mkdir: mock(async (dirPath: string, options?: { recursive?: boolean }) => {
      const resolved = normalizePath(dirPath);
      const allDirs = inferDirectories();

      if (options?.recursive) {
        let current = resolved;
        while (current !== "/" && current !== ".") {
          virtualDirs.add(current);
          current = path.dirname(current);
        }
        return resolved;
      }

      if (allDirs.has(resolved) || virtualFiles.has(resolved)) {
        throw fileExistsError(resolved);
      }

      const parent = path.dirname(resolved);
      if (!inferDirectories().has(parent)) {
        throw fileNotFoundError(parent);
      }

      virtualDirs.add(resolved);
      return resolved;
    }),

    rm: mock(async (filePath: string, options?: { recursive?: boolean; force?: boolean }) => {
      const resolved = normalizePath(filePath);
      if (virtualFiles.has(resolved)) {
        virtualFiles.delete(resolved);
        return;
      }

      if (options?.recursive) {
        const prefix = resolved.endsWith("/") ? resolved : resolved + "/";
        for (const key of Array.from(virtualFiles.keys())) {
          if (key.startsWith(prefix) || key === resolved) {
            virtualFiles.delete(key);
          }
        }
        for (const dir of Array.from(virtualDirs)) {
          if (dir.startsWith(prefix) || dir === resolved) {
            virtualDirs.delete(dir);
          }
        }
        return;
      }

      if (!options?.force) {
        throw fileNotFoundError(resolved);
      }
    }),

    rename: mock(async (oldPath: string, newPath: string) => {
      const resolvedOld = normalizePath(oldPath);
      const resolvedNew = normalizePath(newPath);
      const content = virtualFiles.get(resolvedOld);
      if (content === undefined) {
        throw fileNotFoundError(resolvedOld);
      }
      virtualFiles.delete(resolvedOld);
      virtualFiles.set(resolvedNew, content);
    }),

    copyFile: mock(async (src: string, dest: string) => {
      const resolvedSrc = normalizePath(src);
      const resolvedDest = normalizePath(dest);
      const content = virtualFiles.get(resolvedSrc);
      if (content === undefined) {
        throw fileNotFoundError(resolvedSrc);
      }
      virtualFiles.set(resolvedDest, content);
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock implementation of synchronous fs (node:fs)
// ---------------------------------------------------------------------------

function buildMockFsSync() {
  return {
    readFileSync: mock((filePath: string, _options?: unknown) => {
      const resolved = normalizePath(filePath);
      const content = virtualFiles.get(resolved);
      if (content === undefined) {
        throw fileNotFoundError(resolved);
      }
      return content;
    }),

    writeFileSync: mock((filePath: string, data: string, _options?: unknown) => {
      const resolved = normalizePath(filePath);
      virtualFiles.set(resolved, data);
    }),

    existsSync: mock((filePath: string) => {
      const resolved = normalizePath(filePath);
      return virtualFiles.has(resolved) || inferDirectories().has(resolved);
    }),

    statSync: mock((filePath: string) => {
      const resolved = normalizePath(filePath);
      const allDirs = inferDirectories();

      if (virtualFiles.has(resolved)) {
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: virtualFiles.get(resolved)!.length,
        };
      }

      if (allDirs.has(resolved)) {
        return {
          isFile: () => false,
          isDirectory: () => true,
          size: 0,
        };
      }

      throw fileNotFoundError(resolved);
    }),

    mkdirSync: mock((dirPath: string, options?: { recursive?: boolean }) => {
      const resolved = normalizePath(dirPath);
      if (options?.recursive) {
        let current = resolved;
        while (current !== "/" && current !== ".") {
          virtualDirs.add(current);
          current = path.dirname(current);
        }
        return resolved;
      }
      virtualDirs.add(resolved);
      return resolved;
    }),

    readdirSync: mock((dirPath: string) => {
      const resolved = normalizePath(dirPath);
      const allDirs = inferDirectories();

      if (!allDirs.has(resolved)) {
        throw fileNotFoundError(resolved);
      }

      const entries: string[] = [];
      const prefix = resolved.endsWith("/") ? resolved : resolved + "/";

      for (const filePath of virtualFiles.keys()) {
        if (filePath.startsWith(prefix)) {
          const relative = filePath.slice(prefix.length);
          const firstSegment = relative.split("/")[0];
          if (firstSegment && !entries.includes(firstSegment)) {
            entries.push(firstSegment);
          }
        }
      }

      return entries.sort();
    }),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Populate the virtual filesystem and replace `node:fs/promises` and `node:fs`
 * with mock implementations backed by the virtual tree.
 *
 * @param files  Record mapping absolute paths to file contents.
 */
export function mockFS(files: Record<string, string> = {}): void {
  // Reset internal state
  virtualFiles = new Map();
  virtualDirs = new Set();

  // Populate
  for (const [filePath, content] of Object.entries(files)) {
    virtualFiles.set(normalizePath(filePath), content);
  }

  const mockPromises = buildMockFsPromises();
  const mockSync = buildMockFsSync();

  mock.module("node:fs/promises", () => ({
    default: mockPromises,
    ...mockPromises,
  }));

  mock.module("fs/promises", () => ({
    default: mockPromises,
    ...mockPromises,
  }));

  mock.module("node:fs", () => ({
    default: { ...mockSync, promises: mockPromises },
    ...mockSync,
    promises: mockPromises,
  }));

  mock.module("fs", () => ({
    default: { ...mockSync, promises: mockPromises },
    ...mockSync,
    promises: mockPromises,
  }));
}

/**
 * Clear the virtual filesystem and restore default Bun module resolution.
 *
 * Note: `mock.module` in Bun does not support un-mocking; calling `resetFS`
 * clears internal state so subsequent reads/writes fail with ENOENT, which
 * is the safest approximation of "no filesystem" in a test.
 */
export function resetFS(): void {
  virtualFiles = new Map();
  virtualDirs = new Set();
}

/**
 * Add or update files in the existing virtual filesystem without re-running
 * `mock.module`. Useful for simulating file creation during a test.
 */
export function addVirtualFiles(files: Record<string, string>): void {
  for (const [filePath, content] of Object.entries(files)) {
    virtualFiles.set(normalizePath(filePath), content);
  }
}

/**
 * Remove a file from the virtual filesystem.
 */
export function removeVirtualFile(filePath: string): boolean {
  return virtualFiles.delete(normalizePath(filePath));
}

/**
 * Snapshot the current state of the virtual filesystem.
 * Useful for assertions in tests.
 */
export function getVirtualFiles(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of virtualFiles.entries()) {
    result[key] = value;
  }
  return result;
}
