import { getConfiguredProvider } from "../providers";
import type { AtomicConfig } from "../providers";

function getLineIndent(input: string, index: number): string {
  const lineStart = input.lastIndexOf("\n", index - 1) + 1;
  const prefix = input.slice(lineStart, index);
  const match = prefix.match(/^[\t ]*/);
  return match?.[0] ?? "";
}

function toYamlList(items: readonly string[], indent: string): string {
  return items.map((item) => `${indent}- ${item}`).join("\n");
}

/**
 * Resolve Atomic template variables.
 *
 * Supports:
 * - ${{ provider.commands.* }}
 * - ${{ provider.allowedTools }} (renders YAML list)
 */
export async function resolveTemplate(
  template: string,
  config: AtomicConfig
): Promise<string> {
  const provider = getConfiguredProvider(config);

  return template.replace(/\$\{\{\s*([^}]+?)\s*}}/g, (match, expr: string, offset: number) => {
    const expression = String(expr).trim();

    if (expression === "provider.allowedTools") {
      const indent = getLineIndent(template, offset);
      return toYamlList(provider.allowedTools, indent);
    }

    if (expression.startsWith("provider.commands.")) {
      const key = expression.slice("provider.commands.".length) as keyof typeof provider.commands;
      const value = provider.commands[key];
      return typeof value === "string" ? value : match;
    }

    if (expression === "provider.name") {
      return provider.name;
    }

    if (expression === "provider.displayName") {
      return provider.displayName;
    }

    return match;
  });
}
