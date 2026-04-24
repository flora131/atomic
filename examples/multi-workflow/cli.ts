/**
 * Multi-workflow CLI — two small Claude workflows under a single entrypoint.
 *
 * `createWorkflowCli([hello, goodbye])` exposes both workflows under
 * `-n/--name` dispatch and builds the union of their declared `--<input>`
 * flags (`--who` from `hello`, `--tone` from `goodbye`). Passing `-a claude`
 * without `-n` in a TTY opens the interactive picker.
 *
 * Try:
 *   bun run examples/multi-workflow/cli.ts -n hello   -a claude --who=Alex
 *   bun run examples/multi-workflow/cli.ts -n goodbye -a claude --tone=melodramatic
 *   bun run examples/multi-workflow/cli.ts -a claude                     # picker
 *
 * Registry variant — use this when you compose programmatically (conditional
 * or loop-driven registration):
 *
 *   import { createRegistry } from "@bastani/atomic/workflows";
 *   const registry = createRegistry().register(hello).register(goodbye);
 *   await createWorkflowCli(registry).run();
 *
 * The array form and the registry form produce an identical CLI at runtime;
 * pick whichever is cleanest in your composition root.
 */

import { createWorkflowCli } from "@bastani/atomic/workflows";
import hello from "./hello/claude.ts";
import goodbye from "./goodbye/claude.ts";

await createWorkflowCli([hello, goodbye]).run();
