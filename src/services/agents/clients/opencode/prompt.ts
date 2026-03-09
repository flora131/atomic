type OpenCodeTextPart = { type: "text"; text: string };
type OpenCodeAgentPart = {
  type: "agent";
  name: string;
  source?: { value: string; start: number; end: number };
};

type OpenCodePromptPart = OpenCodeTextPart | OpenCodeAgentPart;

function buildOpenCodePromptText(
  message: string,
  additionalInstructions?: string,
): string {
  const trimmedInstructions = additionalInstructions?.trim();
  if (!trimmedInstructions) {
    return message;
  }

  return [
    "<additional_instructions>",
    trimmedInstructions,
    "</additional_instructions>",
    "",
    message,
  ].join("\n");
}

export function buildOpenCodePromptParts(
  message: string,
  agentName?: string,
  additionalInstructions?: string,
): OpenCodePromptPart[] {
  const resolvedMessage = agentName
    ? message
    : buildOpenCodePromptText(message, additionalInstructions);

  if (!agentName) {
    return [{ type: "text", text: resolvedMessage }];
  }

  const parts: OpenCodePromptPart[] = [];
  if (resolvedMessage.trim()) {
    parts.push({ type: "text", text: resolvedMessage });
  }

  parts.push({ type: "agent", name: agentName });
  return parts;
}
