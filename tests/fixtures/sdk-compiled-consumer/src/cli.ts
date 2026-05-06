/**
 * Minimal Commander CLI that embeds a runWorkflow call.
 *
 * Compiled into `dist/my-app` via:
 *   bun build --compile --outfile dist/my-app src/cli.ts
 *
 * Used by the smoke matrix to verify the third-party-compiled-binary
 * scenario described in the SDK README's "Distribution" section.
 *
 * The very first statement is `await handleSelfDispatch()` — when atomic
 * spawns this binary as `<my-app> _orchestrator-entry <args>` (the
 * default in compiled mode, since `pathToAtomicExecutable` defaults to
 * `process.execPath`), the helper intercepts argv before Commander
 * parses it, runs the SDK's internal sub-command, and exits. For all
 * other invocations (`<my-app> greet`, …) the helper returns and
 * Commander runs the user-facing command tree normally.
 *
 * Environment variables honoured:
 *   ATOMIC_EXECUTABLE  — forwarded to `pathToAtomicExecutable` (use this
 *                         when you'd rather route through atomic's binary
 *                         than the consumer's own self-dispatch).
 *   ATOMIC_DEBUG=1     — passed through to the SDK resolver for debug output.
 */

import { handleSelfDispatch } from "@bastani/atomic-sdk/dispatcher";
await handleSelfDispatch();

import { Command } from "@commander-js/extra-typings";
import { runWorkflow } from "@bastani/atomic-sdk/workflows";
import { isCompiledBinaryRuntime } from "@bastani/atomic-sdk/lib/runtime-env";
import { greetWorkflow } from "./workflow.ts";

/** True when this entry was executed from a `bun build --compile` binary. */
const IS_COMPILED = isCompiledBinaryRuntime(import.meta.dir);

const program = new Command("my-app").description(
  "sdk-compiled-consumer smoke fixture",
);

program
  .command("greet")
  .description("Run the fixture greeting workflow")
  .option("--who <name>", "who to greet", "fixture")
  .option(
    "--atomic-executable <path>",
    "path to atomic binary (overrides SDK resolver)",
    process.env["ATOMIC_EXECUTABLE"],
  )
  .action(async (opts) => {
    const explicitOverride =
      opts.atomicExecutable && opts.atomicExecutable.length > 0
        ? opts.atomicExecutable
        : undefined;

    // In compiled mode the SDK's bundled cli.ts is bunfs-only, so
    // `host-bun` resolution can't work. Route through this same binary
    // (handleSelfDispatch above catches `_orchestrator-entry`).
    // In `bun src/cli.ts` mode we leave the override unset so the SDK's
    // own host-bun resolution kicks in.
    //
    // `ATOMIC_DISABLE_DEFAULT_EXEC` is a smoke-test seam for exercising
    // the NoDispatcherError branch; production callers don't set it.
    const disableDefault = process.env["ATOMIC_DISABLE_DEFAULT_EXEC"] === "1";
    const compiledDefault = IS_COMPILED && !disableDefault ? process.execPath : undefined;
    const pathToAtomicExecutable = explicitOverride ?? compiledDefault;

    await runWorkflow({
      workflow: greetWorkflow,
      inputs: { who: opts.who },
      detach: true,
      pathToAtomicExecutable,
    });

    // Success marker — smoke test asserts stdout contains this string.
    console.log("workflow:launched");
  });

await program.parseAsync();
