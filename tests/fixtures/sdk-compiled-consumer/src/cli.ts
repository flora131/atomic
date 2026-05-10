/**
 * Minimal Commander CLI that embeds a runWorkflow call.
 *
 * Compiled into `dist/my-app` via:
 *   bun build --compile --outfile dist/my-app src/cli.ts
 *
 * Used by the smoke matrix to verify the third-party-compiled-binary
 * scenario described in the SDK README's "Distribution" section.
 *
 * Note: there is no boilerplate at the top of this file. The SDK talks to
 * the Atomic daemon over JSON-RPC; no hidden argv self-dispatch is required.
 *
 * Environment variables honoured:
 *   ATOMIC_EXECUTABLE  — forwarded to `pathToAtomicExecutable`.
 *   ATOMIC_DEBUG=1     — passed through to the SDK resolver for debug output.
 */

import { Command } from "@commander-js/extra-typings";
import { closeDaemonConnection, runWorkflow } from "@bastani/atomic-sdk/workflows";
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

    const pathToAtomicExecutable = explicitOverride;

    const result = await runWorkflow({
      workflow: greetWorkflow,
      inputs: { who: opts.who },
      detach: true,
      pathToAtomicExecutable,
    });
    closeDaemonConnection(result.daemon);

    // Success marker — smoke test asserts stdout contains this string.
    console.log("workflow:launched");
  });

await program.parseAsync();
