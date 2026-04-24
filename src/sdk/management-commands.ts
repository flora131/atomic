/**
 * Session + status management subcommands for workflow CLIs.
 *
 * Shared by the atomic CLI root (`atomic session *`, `atomic workflow status`)
 * and by SDK-built CLIs (`createWorkflowCli(...)`). Factoring this out means a
 * user running `bun run src/claude-worker.ts session list` gets the identical
 * command surface as `atomic session list`, without the SDK embedding its own
 * diverging implementation. All queries go through the shared atomic tmux
 * socket, so sessions spawned by SDK-built CLIs and by `atomic workflow -n …`
 * show up interchangeably.
 *
 * Commander options are declared with the same names, descriptions, and
 * behaviour as the atomic root CLI — keep them in sync when the root CLI
 * grows a new option.
 */

import type { Command } from "@commander-js/extra-typings";
import type { SessionScope } from "../commands/cli/session.ts";

/** Commander collect helper: accumulates repeated `-a` values into an array. */
function collectAgent(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Attach the `session` subcommand group (`list` / `connect` / `kill`) to a
 * parent Commander command. Returns the created `session` group so callers
 * can attach additional children if they need to.
 *
 * @param parent The Commander command to mount `session` under.
 * @param scope  Which session set the list/kill commands operate on. SDK CLIs
 *               typically pass `"workflow"` to scope the picker to
 *               `atomic-wf-*` sessions only; the atomic root uses `"all"`.
 */
export function addSessionSubcommand(
  parent: Command,
  scope: SessionScope = "all",
): Command {
  const sessionCmd = parent
    .command("session")
    .description("Manage running tmux sessions on the atomic socket");

  sessionCmd
    .command("list")
    .description("List running sessions on the atomic tmux socket")
    .option(
      "-a, --agent <name>",
      "Filter by agent backend (claude, copilot, opencode); repeatable",
      collectAgent,
      [] as string[],
    )
    .action(async (localOpts) => {
      const { sessionListCommand } = await import(
        "../commands/cli/session.ts"
      );
      const exitCode = await sessionListCommand(localOpts.agent, scope);
      process.exit(exitCode);
    });

  sessionCmd
    .command("connect")
    .description("Attach to a running session (interactive picker when no id given)")
    .argument("[session_id]", "Session name to connect to")
    .option(
      "-a, --agent <name>",
      "Filter picker by agent backend (claude, copilot, opencode); repeatable",
      collectAgent,
      [] as string[],
    )
    .action(async (sessionId, localOpts) => {
      if (sessionId) {
        const { sessionConnectCommand } = await import(
          "../commands/cli/session.ts"
        );
        const exitCode = await sessionConnectCommand(sessionId);
        process.exit(exitCode);
      } else {
        const { sessionPickerCommand } = await import(
          "../commands/cli/session.ts"
        );
        const exitCode = await sessionPickerCommand(localOpts.agent, scope);
        process.exit(exitCode);
      }
    });

  sessionCmd
    .command("kill")
    .description("Kill a running session (omit id to kill all in scope)")
    .argument("[session_id]", "Session name to kill (omit to kill all)")
    .option(
      "-a, --agent <name>",
      "Filter by agent backend (claude, copilot, opencode); repeatable",
      collectAgent,
      [] as string[],
    )
    .option("-y, --yes", "Skip the confirmation prompt (required for agent callers)")
    .action(async (sessionId, localOpts) => {
      const { sessionKillCommand } = await import(
        "../commands/cli/session.ts"
      );
      const exitCode = await sessionKillCommand(
        sessionId,
        localOpts.agent,
        scope,
        undefined,
        { yes: localOpts.yes === true },
      );
      process.exit(exitCode);
    });

  return sessionCmd;
}

/**
 * Attach a top-level `status` subcommand for querying workflow status.
 * Mirrors `atomic workflow status` — same overall-state contract
 * (`in_progress` / `error` / `completed` / `needs_review`) and same JSON
 * shape. Omit the id to list every running workflow on the socket.
 */
export function addStatusSubcommand(parent: Command): void {
  parent
    .command("status")
    .description(
      "Query workflow status (in_progress, error, completed, needs_review); omit id to list all",
    )
    .argument("[session_id]", "Workflow tmux session id (omit to list all)")
    .option("--format <format>", "Output format: json | text", "json")
    .action(async (sessionId, localOpts) => {
      const { workflowStatusCommand } = await import(
        "../commands/cli/workflow-status.ts"
      );
      const exitCode = await workflowStatusCommand({
        id: sessionId,
        format: localOpts.format === "text" ? "text" : "json",
      });
      process.exit(exitCode);
    });
}

/**
 * Convenience: attach both `session` and `status` subcommands in the order
 * the SDK defaults use. Called by `createWorkflowCli` when
 * `includeManagementCommands` is `true` (the default).
 */
export function addManagementCommands(
  parent: Command,
  scope: SessionScope = "workflow",
): void {
  addSessionSubcommand(parent, scope);
  addStatusSubcommand(parent);
}
