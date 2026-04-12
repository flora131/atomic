import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

function isSubPath(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  return isSubPath(resolve(rootPath), resolve(candidatePath));
}

export function assertPathWithinRoot(
  rootPath: string,
  candidatePath: string,
  label: string,
): void {
  if (!isPathWithinRoot(rootPath, candidatePath)) {
    throw new Error(`${label} escapes allowed root: ${candidatePath}`);
  }
}

export async function assertRealPathWithinRoot(
  rootPath: string,
  candidatePath: string,
  label: string,
): Promise<string> {
  const [resolvedRootPath, resolvedCandidatePath] = await Promise.all([
    realpath(rootPath),
    realpath(candidatePath),
  ]);

  if (!isSubPath(resolvedRootPath, resolvedCandidatePath)) {
    throw new Error(`${label} resolves outside allowed root: ${candidatePath}`);
  }

  return resolvedCandidatePath;
}
