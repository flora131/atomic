import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

export const bashToolRenderer: ToolRenderer = {
  icon: "$",

  getTitle(props: ToolRenderProps): string {
    const command = (props.input.command ?? props.input.cmd) as string | undefined;
    if (!command) {
      return "Run command";
    }

    const maxLen = 50;
    return command.length > maxLen ? command.slice(0, maxLen - 3) + "..." : command;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    const command = (props.input.command ?? props.input.cmd ?? "") as string;
    let output: string | undefined;

    if (typeof props.output === "string") {
      try {
        const parsed = JSON.parse(props.output);
        if (parsed.stdout) {
          output = parsed.stdout;
        } else if (parsed.output) {
          output = parsed.output;
        } else {
          output = props.output;
        }
      } catch {
        output = props.output;
      }
    } else if (props.output && typeof props.output === "object") {
      const record = props.output as Record<string, unknown>;
      if (typeof record.stdout === "string") {
        output = record.stdout;
      } else if (typeof record.output === "string") {
        output = record.output;
      } else {
        output = JSON.stringify(props.output, null, 2);
      }
    }

    const content = [`$ ${command}`];
    if (output) {
      content.push("");
      content.push(...output.split("\n"));
    }

    return {
      title: command,
      content,
      language: "bash",
      expandable: true,
    };
  },
};
