export function lastAssistantText(
  messages: readonly { role?: string; content?: unknown }[],
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content
      .filter((block): block is { type: string; text?: unknown } =>
        typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text",
      )
      .map((block) => String(block.text ?? ""))
      .join("");
  }
  return "";
}
