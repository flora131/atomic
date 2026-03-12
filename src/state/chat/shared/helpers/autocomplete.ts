import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { CommandCategory, CommandDefinition } from "@/commands/tui/index.ts";
import { globalRegistry, parseSlashCommand } from "@/commands/tui/index.ts";

export function getMentionSuggestions(input: string): CommandDefinition[] {
  const suggestions: CommandDefinition[] = [];
  const searchKey = input.toLowerCase();
  const allAgents = globalRegistry.all().filter((cmd) => cmd.category === "agent");
  const agentMatches = searchKey
    ? allAgents.filter((cmd) => cmd.name.toLowerCase().includes(searchKey))
    : allAgents;

  agentMatches.sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(searchKey);
    const bPrefix = b.name.toLowerCase().startsWith(searchKey);
    if (aPrefix && !bPrefix) return -1;
    if (!aPrefix && bPrefix) return 1;
    return a.name.localeCompare(b.name);
  });
  suggestions.push(...agentMatches);

  try {
    const cwd = process.cwd();
    const allEntries: Array<{ relPath: string; isDir: boolean }> = [];

    const scanDirectory = (dirPath: string, relativeBase: string) => {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          if (entry.name === "node_modules") continue;
          if (entry.name === "target") continue;
          if (entry.name === "build") continue;
          if (entry.name === "dist") continue;
          if (entry.name === "out") continue;
          if (entry.name === "coverage") continue;

          const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
          const isDir = entry.isDirectory();
          allEntries.push({ relPath: isDir ? `${relPath}/` : relPath, isDir });

          if (isDir) {
            scanDirectory(join(dirPath, entry.name), relPath);
          }
        }
      } catch {
      }
    };

    scanDirectory(cwd, "");

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

    const fileMatches = mixed.map((entry) => ({
      name: entry.relPath,
      description: "",
      category: (entry.isDir ? "folder" : "file") as CommandCategory,
      execute: () => ({ success: true as const }),
    }));

    suggestions.push(...fileMatches);
  } catch {
  }

  return suggestions;
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
