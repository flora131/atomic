/**
 * Runtime wiring helpers — construct StageAdapters from Pi runtime surfaces.
 *
 * The pi ExtensionAPI is structurally typed here: only the `exec` surface is
 * required to build adapters.  When `exec` is absent (degraded / test runtime),
 * `buildRuntimeAdapters` returns an empty adapter set; stage-runner's built-in
 * error messages will fire if any adapter is actually invoked.
 *
 * Each adapter spawns `pi --mode json` as a one-shot subprocess and extracts
 * the final assistant text from the NDJSON event stream.
 *
 * cross-ref: packages/pi-workflows/src/runs/sync/stage-runner.ts
 *            packages/pi-workflows/src/extension/index.ts
 *            research/docs/2026-05-11-pi-coding-agent-reference.md §4.3 pi --mode json
 */

import type { StageAdapters } from "../runs/sync/stage-runner.js";
import type { SubagentStageOpts, CompleteStageOpts } from "../shared/types.js";

// ---------------------------------------------------------------------------
// Minimal pi surface
// ---------------------------------------------------------------------------

/** ExecResult shape returned by pi.exec() — structurally matched, not imported. */
export interface PiExecResult {
  stdout: string;
  stderr: string;
  code: number;
  killed: boolean;
}

/**
 * Minimal pi runtime surface needed to build stage adapters.
 * Structurally typed so it works against both the real ExtensionAPI and mocks.
 */
export interface RuntimeWiringSurface {
  /**
   * Execute a shell command.
   * Present on the real pi ExtensionAPI; may be absent in degraded / test runtimes.
   */
  exec?: (command: string, args: string[]) => Promise<PiExecResult>;
}

// ---------------------------------------------------------------------------
// NDJSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract the final assistant text from pi `--mode json` NDJSON output.
 * Searches backwards for the last `message_end` event whose message.role
 * is "assistant", then concatenates all `text`-typed content blocks.
 *
 * Returns an empty string when no matching event is found (caller decides
 * whether to treat this as an error).
 */
export function extractAssistantText(ndjson: string): string {
  const lines = ndjson.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] !== "message_end") continue;
      const msg = event["message"] as Record<string, unknown> | undefined;
      if (!msg || msg["role"] !== "assistant") continue;
      const content = msg["content"];
      if (!Array.isArray(content)) continue;
      const text = (content as Array<Record<string, unknown>>)
        .filter((c) => c["type"] === "text")
        .map((c) => String(c["text"] ?? ""))
        .join("");
      if (text) return text;
    } catch {
      // skip malformed line
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build StageAdapters from available pi runtime surfaces.
 *
 * Adapters built:
 * - **prompt**: `pi --mode json -p <text> --no-session` → assistant text
 * - **complete**: same + optional `--model` flag from CompleteStageOpts
 * - **subagent**: `pi --mode json -p <task> --no-session`, prefixing context
 *   and agent name into the prompt when present
 *
 * Returns `{}` (no adapters) when `pi.exec` is absent; in that case the
 * stage-runner will throw its standard "adapter not configured" errors.
 *
 * @example
 * ```ts
 * // In extension factory:
 * const adapters = buildRuntimeAdapters(pi);
 * const runtime = createExtensionRuntime({ registry, adapters });
 * ```
 */
export function buildRuntimeAdapters(pi: RuntimeWiringSurface): StageAdapters {
  if (typeof pi.exec !== "function") {
    return {};
  }

  const exec = pi.exec.bind(pi as { exec: RuntimeWiringSurface["exec"] });

  async function runPiJson(args: string[]): Promise<string> {
    const result = await exec!("pi", args);
    // Non-zero exit with no stdout → hard error
    if (result.code !== 0 && !result.stdout.trim()) {
      throw new Error(
        `pi-workflows: pi subprocess exited with code ${result.code}: ${result.stderr.slice(0, 200)}`,
      );
    }
    const text = extractAssistantText(result.stdout);
    if (!text) {
      throw new Error(
        "pi-workflows: pi subprocess produced no assistant text — check pi installation",
      );
    }
    return text;
  }

  return {
    prompt: {
      async prompt(text: string): Promise<string> {
        return runPiJson(["--mode", "json", "-p", text, "--no-session"]);
      },
    },

    complete: {
      async complete(text: string, opts?: CompleteStageOpts): Promise<string> {
        const args = ["--mode", "json", "-p", text, "--no-session"];
        if (opts?.model) {
          args.push("--model", opts.model);
        }
        return runPiJson(args);
      },
    },

    subagent: {
      async subagent(opts: SubagentStageOpts): Promise<string> {
        // Prepend agent identity and optional context into the task prompt so
        // the spawned pi session understands its role without requiring a
        // separately resolved agent definition file.
        const parts: string[] = [];
        if (opts.context) {
          parts.push(`Context: ${opts.context}`);
        }
        parts.push(`Agent: ${opts.agent}`);
        parts.push(`Task: ${opts.task}`);
        const taskText = parts.join("\n\n");
        return runPiJson(["--mode", "json", "-p", taskText, "--no-session"]);
      },
    },
  };
}
