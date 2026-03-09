import type { CommandCategory, CommandDefinition } from "@/commands/core/types.ts";

function sortCommands(commands: CommandDefinition[], searchKey: string): CommandDefinition[] {
  const categoryPriority: Record<CommandCategory, number> = {
    workflow: 0,
    skill: 1,
    agent: 2,
    builtin: 3,
    folder: 4,
    file: 5,
  };

  return commands.sort((a, b) => {
    const aExact = a.name.toLowerCase() === searchKey;
    const bExact = b.name.toLowerCase() === searchKey;
    if (aExact && !bExact) return -1;
    if (bExact && !aExact) return 1;

    const aPriority = categoryPriority[a.category];
    const bPriority = categoryPriority[b.category];
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }

    return a.name.localeCompare(b.name);
  });
}

export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();
  private aliases: Map<string, string> = new Map();

  register(command: CommandDefinition): void {
    const name = command.name.toLowerCase();
    if (this.commands.has(name) || this.aliases.has(name)) {
      throw new Error(`Command name '${name}' is already registered`);
    }

    this.commands.set(name, command);

    if (!command.aliases) {
      return;
    }

    for (const alias of command.aliases) {
      const aliasLower = alias.toLowerCase();
      if (this.commands.has(aliasLower) || this.aliases.has(aliasLower)) {
        throw new Error(`Alias '${aliasLower}' conflicts with existing command or alias`);
      }

      this.aliases.set(aliasLower, name);
    }
  }

  unregister(name: string): boolean {
    const key = name.toLowerCase();
    const command = this.commands.get(key);
    if (!command) {
      return false;
    }

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.delete(alias.toLowerCase());
      }
    }

    this.commands.delete(key);
    return true;
  }

  get(nameOrAlias: string): CommandDefinition | undefined {
    const key = nameOrAlias.toLowerCase();
    const command = this.commands.get(key);
    if (command) {
      return command;
    }

    const primaryName = this.aliases.get(key);
    return primaryName ? this.commands.get(primaryName) : undefined;
  }

  search(prefix: string): CommandDefinition[] {
    const searchKey = prefix.toLowerCase();
    const matches: CommandDefinition[] = [];
    const seenCommands = new Set<string>();

    for (const [name, command] of this.commands) {
      if (name.startsWith(searchKey) && !command.hidden) {
        matches.push(command);
        seenCommands.add(name);
      }
    }

    for (const [alias, primaryName] of this.aliases) {
      if (alias.startsWith(searchKey) && !seenCommands.has(primaryName)) {
        const command = this.commands.get(primaryName);
        if (command && !command.hidden) {
          matches.push(command);
          seenCommands.add(primaryName);
        }
      }
    }

    return sortCommands(matches, searchKey);
  }

  all(): CommandDefinition[] {
    const commands: CommandDefinition[] = [];

    for (const command of this.commands.values()) {
      if (!command.hidden) {
        commands.push(command);
      }
    }

    return sortCommands(commands, "");
  }

  has(nameOrAlias: string): boolean {
    return this.get(nameOrAlias) !== undefined;
  }

  size(): number {
    return this.commands.size;
  }

  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }
}

export const globalRegistry = new CommandRegistry();
