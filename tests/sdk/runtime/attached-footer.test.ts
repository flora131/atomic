import { describe, expect, test } from "bun:test";
import {
  buildAttachedFooterCommand,
  buildAttachedFooterCloseHooks,
  resolveAttachedFooterCliPath,
} from "../../../src/sdk/runtime/attached-footer.ts";

function decodeEncodedCommand(cmd: string): string {
  const prefix = "pwsh -NoProfile -EncodedCommand ";
  expect(cmd.startsWith(prefix)).toBe(true);
  return Buffer.from(cmd.slice(prefix.length), "base64").toString("utf16le");
}

describe("attached footer command harness", () => {
  test("builds the POSIX footer command with bash-safe quoting", () => {
    const cmd = buildAttachedFooterCommand({
      runtime: "/opt/bun/bin/bun",
      cliPath: "/repo/src/cli.ts",
      windowName: "atomic-wf-claude-ralph-a$b`c!",
      agentType: "claude",
      platform: "linux",
    });

    expect(cmd).toBe(
      '"/opt/bun/bin/bun" "/repo/src/cli.ts" _footer --name "atomic-wf-claude-ralph-a\\$b\\`c\\!" --agent "claude"',
    );
  });

  test("builds a Windows footer command that invokes paths through PowerShell", () => {
    const cmd = buildAttachedFooterCommand({
      runtime: "C:\\Program Files\\Bun\\bun.exe",
      cliPath: "C:\\Users\\alexlavaee\\atomic repo\\src\\cli.ts",
      windowName: "atomic-wf-copilot-ralph-abcd1234",
      agentType: "copilot",
      platform: "win32",
    });

    expect(decodeEncodedCommand(cmd)).toBe(
      "& 'C:\\Program Files\\Bun\\bun.exe' 'C:\\Users\\alexlavaee\\atomic repo\\src\\cli.ts' '_footer' '--name' 'atomic-wf-copilot-ralph-abcd1234' '--agent' 'copilot'",
    );
  });

  test("Windows command literals preserve metacharacters without bash escaping", () => {
    const cmd = buildAttachedFooterCommand({
      runtime: "C:\\Users\\alexlavaee\\.bun\\bin\\bun.exe",
      cliPath: "C:\\repo\\src\\cli.ts",
      windowName: "wf's $HOME `tick` bang!",
      platform: "win32",
    });

    const script = decodeEncodedCommand(cmd);
    expect(script).toContain("'wf''s $HOME `tick` bang!'");
    expect(script).not.toContain("\\!");
    expect(script).not.toContain("\\$HOME");
  });

  test("resolves the CLI path with Windows separators when simulating win32", () => {
    expect(
      resolveAttachedFooterCliPath("C:\\repo\\src\\sdk\\runtime", "win32"),
    ).toBe("C:\\repo\\src\\cli.ts");
  });

  test("resolves the CLI path with POSIX separators on Unix-like platforms", () => {
    expect(
      resolveAttachedFooterCliPath("/repo/src/sdk/runtime", "linux"),
    ).toBe("/repo/src/cli.ts");
  });

  test("builds guarded footer close hooks for tmux", () => {
    expect(buildAttachedFooterCloseHooks("%1", "%2")).toEqual([
      {
        event: "pane-exited",
        command: "if -F '#{==:#{hook_pane},%1}' 'kill-pane -t %2'",
      },
      {
        event: "after-kill-pane",
        command: "kill-pane -t %2",
      },
    ]);
  });

  test("builds unguarded footer close hooks for psmux", () => {
    expect(
      buildAttachedFooterCloseHooks("%1", "%2", { guardAgentPane: false }),
    ).toEqual([
      { event: "pane-exited", command: "kill-pane -t %2" },
      { event: "after-kill-pane", command: "kill-pane -t %2" },
    ]);
  });
});
