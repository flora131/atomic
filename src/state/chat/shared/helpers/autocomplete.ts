import posix from "node:path/posix";
import type { CommandCategory, CommandDefinition } from "@/commands/tui/index.ts";
import { parseSlashCommand } from "@/commands/tui/index.ts";

function scanGitFiles(): Array<{ relPath: string; isDir: boolean }> {
  const cwd = process.cwd();
  const result = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], { cwd });
  if (!result.success) throw new Error("git ls-files failed");

  const filePaths = result.stdout.toString().split("\n").filter(Boolean);
  const dirSet = new Set<string>();
  const allEntries: Array<{ relPath: string; isDir: boolean }> = [];

  for (const filePath of filePaths) {
    let dir = posix.dirname(filePath);
    while (dir !== ".") {
      const dirKey = `${dir}/`;
      if (dirSet.has(dirKey)) break;
      dirSet.add(dirKey);
      allEntries.push({ relPath: dirKey, isDir: true });
      dir = posix.dirname(dir);
    }
    allEntries.push({ relPath: filePath, isDir: false });
  }

  return allEntries;
}

function scanAllFiles(): Array<{ relPath: string; isDir: boolean }> {
  const glob = new Bun.Glob("**/*");
  const dirSet = new Set<string>();
  const allEntries: Array<{ relPath: string; isDir: boolean }> = [];

  for (const filePath of glob.scanSync({ cwd: process.cwd(), dot: true, onlyFiles: true })) {
    if (filePath.startsWith(".git/") || filePath.includes("node_modules/")) continue;

    let dir = posix.dirname(filePath);
    while (dir !== ".") {
      const dirKey = `${dir}/`;
      if (dirSet.has(dirKey)) break;
      dirSet.add(dirKey);
      allEntries.push({ relPath: dirKey, isDir: true });
      dir = posix.dirname(dir);
    }
    allEntries.push({ relPath: filePath, isDir: false });
  }

  return allEntries;
}

export function getMentionSuggestions(input: string): CommandDefinition[] {
  const searchKey = input.toLowerCase();

  let allEntries: Array<{ relPath: string; isDir: boolean }>;
  try {
    allEntries = scanGitFiles();
  } catch {
    allEntries = scanAllFiles();
  }

  const filtered = searchKey
    ? allEntries.filter((entry) => entry.relPath.toLowerCase().includes(searchKey))
    : allEntries;

  filtered.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.relPath.localeCompare(b.relPath);
  });

  const dirs = filtered.filter((entry) => entry.isDir);
  const files = filtered.filter((entry) => !entry.isDir);
  const maxDirs = Math.min(dirs.length, 7);
  const maxFiles = Math.min(files.length, 15 - maxDirs);
  const mixed = [...dirs.slice(0, maxDirs), ...files.slice(0, maxFiles)];

  return mixed.map((entry) => ({
    name: entry.relPath,
    description: "",
    category: (entry.isDir ? "folder" : "file") as CommandCategory,
    execute: () => ({ success: true as const }),
  }));
}

interface ResolveSlashAutocompleteExecutionArgs {
  rawInput: string;
  selectedCommandName: string;
  getCommandByName: (name: string) => CommandDefinition | undefined;
}

interface ResolvedSlashAutocompleteExecution {
  commandName: string;
  commandArgs: string;
  userMessage: string;
  trigger: "input" | "autocomplete";
}

export function resolveSlashAutocompleteExecution(
  args: ResolveSlashAutocompleteExecutionArgs,
): ResolvedSlashAutocompleteExecution {
  const trimmedInput = args.rawInput.trim();
  const parsed = parseSlashCommand(trimmedInput);

  if (
    parsed.isCommand
    && parsed.args.length > 0
    && args.getCommandByName(parsed.name)
  ) {
    return {
      commandName: parsed.name,
      commandArgs: parsed.args,
      userMessage: trimmedInput,
      trigger: "input",
    };
  }

  return {
    commandName: args.selectedCommandName,
    commandArgs: "",
    userMessage: `/${args.selectedCommandName}`,
    trigger: "autocomplete",
  };
}
