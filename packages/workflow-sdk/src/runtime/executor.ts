/**
 * Workflow runtime executor.
 *
 * Architecture:
 * 1. `executeWorkflow()` is called by the CLI command
 * 2. It creates a tmux session with an orchestrator pane that runs
 *    `bun run executor.ts --run <args>`
 * 3. The CLI then attaches to the tmux session (user sees it live)
 * 4. The orchestrator pane spawns agent windows and drives the SDK calls
 */

import { join, resolve } from "path";
import { homedir } from "os";
import { mkdir, writeFile, readFile } from "fs/promises";
import type {
  WorkflowDefinition, SessionContext, AgentType, Transcript,
  SavedMessage, SaveTranscript,
} from "../types.ts";
import type { SessionEvent } from "@github/copilot-sdk";
import type { SessionPromptResponse } from "@opencode-ai/sdk/v2";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import * as tmux from "./tmux.ts";
import { getMuxBinary } from "./tmux.ts";
import { loadWorkflowDefinition } from "./discovery.ts";
import { clearClaudeSession } from "../providers/claude.ts";
import { OrchestratorPanel } from "./panel.ts";

/** Agent CLI configuration for spawning in tmux panes. */
const AGENT_CLI: Record<AgentType, { cmd: string; chatFlags: string[] }> = {
  copilot: { cmd: "copilot", chatFlags: ["--add-dir", ".", "--yolo", "--experimental"] },
  opencode: { cmd: "opencode", chatFlags: [] },
  claude: { cmd: "claude", chatFlags: ["--allow-dangerously-skip-permissions", "--dangerously-skip-permissions"] },
};

export interface WorkflowRunOptions {
  /** The compiled workflow definition */
  definition: WorkflowDefinition;
  /** Agent type */
  agent: AgentType;
  /** The user's prompt */
  prompt: string;
  /** Absolute path to the workflow's index.ts file (from discovery) */
  workflowFile: string;
  /** Project root (defaults to cwd) */
  projectRoot?: string;
}

interface SessionResult {
  name: string;
  sessionId: string;
  sessionDir: string;
  paneId: string;
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function getSessionsBaseDir(): string {
  return join(homedir(), ".atomic", "sessions");
}

async function getRandomPort(): Promise<number> {
  const net = await import("node:net");

  const MAX_RETRIES = 3;
  let lastPort = 0;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, () => {
        const addr = server.address();
        const p = typeof addr === "object" && addr ? addr.port : 0;
        server.close(() => resolve(p));
      });
      server.on("error", reject);
    });

    if (port > 0) return port;
    lastPort = port;
    await Bun.sleep(50);
  }

  throw new Error(`Failed to acquire a random port after ${MAX_RETRIES} attempts (last: ${lastPort})`);
}

function buildPaneCommand(agent: AgentType, port: number): string {
  const { cmd, chatFlags } = AGENT_CLI[agent];

  switch (agent) {
    case "copilot":
      return [cmd, "--ui-server", "--port", String(port), ...chatFlags].join(" ");
    case "opencode":
      return [cmd, "--port", String(port), ...chatFlags].join(" ");
    case "claude":
      // Claude is started via createClaudeSession() in the workflow's run()
      return process.env.SHELL || (process.platform === "win32" ? "pwsh" : "sh");
    default:
      return [cmd, ...chatFlags].join(" ");
  }
}

async function waitForServer(agent: AgentType, port: number, paneId: string): Promise<string> {
  if (agent === "claude") return "";

  const serverUrl = `localhost:${port}`;
  const deadline = Date.now() + 60_000;

  // Wait for the TUI to render first
  while (Date.now() < deadline) {
    const content = tmux.capturePane(paneId);
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 3) break;
    await Bun.sleep(1_000);
  }

  // Then verify the SDK can actually connect and list sessions
  if (agent === "copilot") {
    const { CopilotClient } = await import("@github/copilot-sdk");
    while (Date.now() < deadline) {
      try {
        const probe = new CopilotClient({ cliUrl: serverUrl });
        await probe.start();
        await probe.listSessions();
        await probe.stop();
        return serverUrl;
      } catch {
        await Bun.sleep(1_000);
      }
    }
  }

  // For OpenCode, give it extra time after TUI renders
  await Bun.sleep(3_000);
  return serverUrl;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Escape a string for safe interpolation inside a bash double-quoted string. */
function escBash(s: string): string {
  if (/[\n\r]/.test(s)) {
    throw new Error("escBash: input contains newline characters which cannot be safely escaped in bash double-quoted strings");
  }
  return s.replace(/[\\"$`!]/g, "\\$&");
}

/** Escape a string for safe interpolation inside a PowerShell double-quoted string. */
function escPwsh(s: string): string {
  return s.replace(/[`"$]/g, "`$&").replace(/\n/g, "`n").replace(/\r/g, "`r");
}

// ============================================================================
// Entry point called by the CLI command
// ============================================================================

/**
 * Called by `atomic workflow -n <name> -a <agent> <prompt>`.
 *
 * Creates a tmux session with the orchestrator as the initial pane,
 * then attaches so the user sees everything live.
 */
export async function executeWorkflow(options: WorkflowRunOptions): Promise<void> {
  const { definition, agent, prompt, workflowFile, projectRoot = process.cwd() } = options;

  const workflowRunId = generateId();
  const tmuxSessionName = `atomic-wf-${definition.name}-${workflowRunId}`;
  const sessionsBaseDir = join(getSessionsBaseDir(), workflowRunId);
  await ensureDir(sessionsBaseDir);

  // Write a launcher script for the orchestrator pane
  const thisFile = resolve(import.meta.dir, "executor.ts");
  const isWin = process.platform === "win32";
  const launcherExt = isWin ? "ps1" : "sh";
  const launcherPath = join(sessionsBaseDir, `orchestrator.${launcherExt}`);
  const logPath = join(sessionsBaseDir, "orchestrator.log");

  const launcherScript = isWin
    ? [
        `Set-Location "${escPwsh(projectRoot)}"`,
        `$env:ATOMIC_WF_ID = "${escPwsh(workflowRunId)}"`,
        `$env:ATOMIC_WF_TMUX = "${escPwsh(tmuxSessionName)}"`,
        `$env:ATOMIC_WF_AGENT = "${escPwsh(agent)}"`,
        `$env:ATOMIC_WF_PROMPT = "${escPwsh(Buffer.from(prompt).toString("base64"))}"`,
        `$env:ATOMIC_WF_FILE = "${escPwsh(workflowFile)}"`,
        `$env:ATOMIC_WF_CWD = "${escPwsh(projectRoot)}"`,
        `bun run "${escPwsh(thisFile)}" --run 2>"${escPwsh(logPath)}"`,
      ].join("\n")
    : [
        "#!/bin/bash",
        `cd "${escBash(projectRoot)}"`,
        `export ATOMIC_WF_ID="${escBash(workflowRunId)}"`,
        `export ATOMIC_WF_TMUX="${escBash(tmuxSessionName)}"`,
        `export ATOMIC_WF_AGENT="${escBash(agent)}"`,
        `export ATOMIC_WF_PROMPT="${escBash(Buffer.from(prompt).toString("base64"))}"`,
        `export ATOMIC_WF_FILE="${escBash(workflowFile)}"`,
        `export ATOMIC_WF_CWD="${escBash(projectRoot)}"`,
        `bun run "${escBash(thisFile)}" --run 2>"${escBash(logPath)}"`,
      ].join("\n");

  await writeFile(launcherPath, launcherScript, { mode: 0o755 });

  // Create tmux session with orchestrator as the initial window
  const shellCmd = isWin
    ? `pwsh -NoProfile -File "${escPwsh(launcherPath)}"`
    : `bash "${escBash(launcherPath)}"`;
  tmux.createSession(tmuxSessionName, shellCmd, "orchestrator");

  // Attach or switch depending on whether we're already inside tmux
  if (tmux.isInsideTmux()) {
    // Inside tmux: switch the current client to the workflow session
    // to avoid creating a nested tmux client
    tmux.switchClient(tmuxSessionName);
  } else {
    // Outside tmux: attach normally (blocks until session ends)
    const muxBinary = getMuxBinary() ?? "tmux";
    const attachProc = Bun.spawn([muxBinary, "attach-session", "-t", tmuxSessionName], {
      stdio: ["inherit", "inherit", "inherit"],
    });
    await attachProc.exited;
  }
}

// ============================================================================
// Orchestrator logic — runs inside a tmux pane
// ============================================================================

async function runOrchestrator(): Promise<void> {
  const requiredEnvVars = [
    "ATOMIC_WF_ID", "ATOMIC_WF_TMUX", "ATOMIC_WF_AGENT",
    "ATOMIC_WF_PROMPT", "ATOMIC_WF_FILE", "ATOMIC_WF_CWD",
  ] as const;
  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  const workflowRunId = process.env.ATOMIC_WF_ID!;
  const tmuxSessionName = process.env.ATOMIC_WF_TMUX!;
  const agent = process.env.ATOMIC_WF_AGENT! as AgentType;
  const prompt = Buffer.from(process.env.ATOMIC_WF_PROMPT!, "base64").toString("utf-8");
  const workflowFile = process.env.ATOMIC_WF_FILE!;
  const cwd = process.env.ATOMIC_WF_CWD!;

  process.chdir(cwd);

  const sessionsBaseDir = join(getSessionsBaseDir(), workflowRunId);
  await ensureDir(sessionsBaseDir);

  const panel = await OrchestratorPanel.create({ tmuxSession: tmuxSessionName });

  // Idempotent shutdown guard
  let shutdownCalled = false;
  const shutdown = (exitCode = 0) => {
    if (shutdownCalled) return;
    shutdownCalled = true;
    panel.destroy();
    try { tmux.killSession(tmuxSessionName); } catch {}
    process.exitCode = exitCode;
  };

  // Wire SIGINT so the terminal is always restored.
  // SIGTERM and other signals are handled by OpenTUI's exitSignals.
  const signalHandler = () => shutdown(1);
  process.on("SIGINT", signalHandler);

  try {
    const definition = await loadWorkflowDefinition(workflowFile);

    await writeFile(
      join(sessionsBaseDir, "metadata.json"),
      JSON.stringify({
        workflowName: definition.name,
        agent,
        prompt,
        projectRoot: cwd,
        startedAt: new Date().toISOString(),
      }, null, 2)
    );

    panel.showWorkflowInfo(
      definition.name,
      agent,
      definition.sessions.map((s) => s.name),
      prompt,
    );

    const completedSessions: SessionResult[] = [];

    for (const sessionDef of definition.sessions) {
      panel.sessionStart(sessionDef.name, sessionDef.description);

      const port = await getRandomPort();
      const paneCmd = buildPaneCommand(agent, port);

      const paneId = tmux.createWindow(tmuxSessionName, sessionDef.name, paneCmd);
      panel.sessionStep(`Spawned ${agent} on port ${port} (window "${sessionDef.name}")`);

      panel.sessionStep(`Waiting for ${agent}\u2026`);
      const serverUrl = await waitForServer(agent, port, paneId);
      panel.sessionStep(`Ready: ${serverUrl || "(tmux send-keys)"}`);

      const sessionId = generateId();
      const sessionDirName = `${sessionDef.name}-${sessionId}`;
      const sessionDir = join(sessionsBaseDir, sessionDirName);
      await ensureDir(sessionDir);

      const messagesPath = join(sessionDir, "messages.json");
      const inboxPath = join(sessionDir, "inbox.md");

      async function wrapMessages(arg: SessionEvent[] | SessionPromptResponse | string): Promise<SavedMessage[]> {
        if (typeof arg === "string") {
          try {
            const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
            const msgs: SessionMessage[] = await getSessionMessages(arg, { dir: process.cwd() });
            return msgs.map((m) => ({ provider: "claude" as const, data: m }));
          } catch {
            return [];
          }
        }

        if (!Array.isArray(arg) && "info" in arg && "parts" in arg) {
          return [{ provider: "opencode" as const, data: arg as SessionPromptResponse }];
        }

        if (Array.isArray(arg)) {
          return (arg as SessionEvent[]).map((m) => ({
            provider: "copilot" as const,
            data: m,
          }));
        }

        return [];
      }

      function renderMessagesToText(messages: SavedMessage[]): string {
        return messages
          .map((m) => {
            if (m.provider === "copilot") {
              if (m.data.type !== "assistant.message") return "";
              return String((m.data.data as Record<string, unknown>).content ?? "");
            }
            if (m.provider === "opencode") {
              return m.data.parts
                .filter((p) => p.type === "text" && "text" in p)
                .map((p) => String((p as { text: string }).text))
                .join("\n");
            }
            if (m.provider === "claude") {
              if (m.data.type !== "assistant") return "";
              const msg = m.data.message;
              if (typeof msg === "string") return msg;
              if (msg && typeof msg === "object" && "content" in msg) {
                const content = (msg as Record<string, unknown>).content;
                if (typeof content === "string") return content;
                if (Array.isArray(content)) {
                  return content
                    .filter((b: Record<string, unknown>) => b.type === "text")
                    .map((b: Record<string, unknown>) => String(b.text ?? ""))
                    .join("\n");
                }
              }
              return JSON.stringify(msg);
            }
            return "";
          })
          .filter((txt) => txt.length > 0)
          .join("\n\n");
      }

      let pendingSave: Promise<void> | null = null;

      const save: SaveTranscript = ((arg: SessionEvent[] | SessionPromptResponse | string) => {
        pendingSave = (async () => {
          const wrapped = await wrapMessages(arg);
          await Bun.write(messagesPath, JSON.stringify(wrapped, null, 2));
          const text = renderMessagesToText(wrapped);
          await Bun.write(inboxPath, text);
        })();
        return pendingSave;
      }) as SaveTranscript;

      const ctx: SessionContext = {
        serverUrl,
        userPrompt: prompt,
        agent,
        sessionDir,
        paneId,
        sessionId,
        save,
        transcript: async (name: string): Promise<Transcript> => {
          const prev = completedSessions.find((s) => s.name === name);
          if (!prev) {
            throw new Error(
              `No transcript for "${name}". Available: ${completedSessions.map((s) => s.name).join(", ") || "(none)"}`
            );
          }
          const filePath = join(prev.sessionDir, "inbox.md");
          const content = await readFile(filePath, "utf-8");
          return { path: filePath, content };
        },
        getMessages: async (name: string): Promise<SavedMessage[]> => {
          const prev = completedSessions.find((s) => s.name === name);
          if (!prev) {
            throw new Error(
              `No messages for "${name}". Available: ${completedSessions.map((s) => s.name).join(", ") || "(none)"}`
            );
          }
          const filePath = join(prev.sessionDir, "messages.json");
          const raw = await readFile(filePath, "utf-8");
          return JSON.parse(raw) as SavedMessage[];
        },
      };

      await writeFile(
        join(sessionDir, "metadata.json"),
        JSON.stringify({
          name: sessionDef.name,
          description: sessionDef.description ?? "",
          agent, paneId, serverUrl, port,
          startedAt: new Date().toISOString(),
        }, null, 2)
      );

      panel.sessionRunning();
      try {
        await sessionDef.run(ctx);
        // Ensure any pending save() writes complete before the next session reads them
        if (pendingSave) await pendingSave;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await writeFile(join(sessionDir, "error.txt"), message);
        panel.sessionError(`Failed: ${message}`);
        panel.showFatalError(message);
        await panel.waitForExit();
        shutdown(1);
        return;
      }

      completedSessions.push({ name: sessionDef.name, sessionId, sessionDir, paneId });
      if (agent === "claude") clearClaudeSession(paneId);
      panel.sessionSuccess("Complete");
    }

    panel.showCompletion(definition.name, sessionsBaseDir);
    await panel.waitForExit();
    shutdown(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      panel.showFatalError(message);
      await panel.waitForExit();
    } catch {}
    shutdown(1);
  } finally {
    process.off("SIGINT", signalHandler);
  }
}

// ============================================================================
// Direct invocation: `bun run executor.ts --run`
// ============================================================================

if (process.argv.includes("--run")) {
  runOrchestrator().catch((err) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  });
}
