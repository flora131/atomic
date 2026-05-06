/**
 * Minimal Commander CLI that embeds a runWorkflow call.
 *
 * Compiled into `dist/my-app` via:
 *   bun build --compile --outfile dist/my-app src/cli.ts
 *
 * Used by the smoke matrix to verify the third-party-compiled-binary
 * scenario described in the SDK README's "Distribution" section.
 *
 * Note: there is no boilerplate at the top of this file. The SDK's
 * `@bastani/atomic-sdk/workflows` barrel intercepts argv at module-load
 * time — when atomic spawns this binary as `<my-app> _orchestrator-entry
 * <args>`, the SDK side-effect runs the sub-command and exits before
 * Commander parses argv.
 *
 * Environment variables honoured:
 *   ATOMIC_EXECUTABLE  — forwarded to `pathToAtomicExecutable` (use this
 *                         when you'd rather route through atomic's binary
 *                         than the consumer's own self-dispatch).
 *   ATOMIC_DEBUG=1     — passed through to the SDK resolver for debug output.
 */

import { Command } from "@commander-js/extra-typings";
import { runWorkflow } from "@bastani/atomic-sdk/workflows";
import { greetWorkflow } from "./workflow.ts";

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

    // `ATOMIC_DISABLE_DEFAULT_EXEC` is a smoke-test seam for exercising
    // the NoDispatcherError branch — it forces the SDK to skip its
    // compiled-host auto-default by passing an empty string (falsy in
    // the resolver but distinct from `undefined`, which would re-trigger
    // the auto-default).
    const disableDefault = process.env["ATOMIC_DISABLE_DEFAULT_EXEC"] === "1";
    const pathToAtomicExecutable = explicitOverride
      ?? (disableDefault ? "" : undefined);

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
