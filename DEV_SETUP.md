# @bastani/atomic-workflows — Development Setup

This document covers setup, the local dev loop, testing patterns, and project layout for working on `@bastani/atomic-workflows`. End users should start with the [README](./README.md).

---

## Prerequisites

- **Node ≥ 22** — required for `--experimental-strip-types` / `--experimental-transform-types`
- **npm ≥ 10**
- **pi** — `npm install -g @earendil-works/pi-coding-agent`

This repo uses **npm + Node.js**.

The package ships raw `.ts` files with no build step. Do not introduce `dist/`, `tsconfig.build.json`, `outDir`, or bundling. Tests run via `node --experimental-transform-types` + the `test/support/register-loader.mjs` hook.

---

## Setup

```bash
git clone git@github.com:flora131/atomic.git
cd atomic
npm install
```

---

## Local dev loop with pi

Three options, from heaviest to lightest:

### A. `pi install` against the local path (persisted)

```bash
pi install -l "$PWD"   # project-local
# or
pi install    "$PWD"   # global
```

Pi adds the absolute path to its settings file and resolves the package's `pi` manifest. From inside pi, `/reload` re-imports the extension after you edit source — no restart needed.

### B. One-off load with `-e` (no settings write)

```bash
pi -e "$PWD/src/extension/index.ts"
```

The fastest iteration loop. Combine with `--no-extensions` to isolate the extension under test:

```bash
pi --no-extensions \
   -e "$PWD/src/extension/index.ts" \
   "/workflow list"
```

Pass an initial prompt at the end to drive a single command and exit (works with `-p` for print mode).

### C. Symlink into the extensions directory

```bash
mkdir -p ~/.pi/agent/extensions
ln -s "$PWD" ~/.pi/agent/extensions/workflows
```

Useful when you want the extension persisted globally but don't want pi to track it in settings.

> Pi's docs explicitly call out `pi -e <path>` as the recommended path for "quick tests" and `pi install` / auto-discovered locations as the path for resources that need `/reload` hot-reload. See [pi docs/extensions.md](https://github.com/earendil-works/pi-mono/blob/main/docs/extensions.md).

---

## Commands

| Command                    | Description                 |
| -------------------------- | --------------------------- |
| `npm run typecheck`        | Type-check the package      |
| `npm test`                 | Run unit tests              |
| `npm run test:unit`        | Run unit tests              |
| `npm run test:integration` | Run integration tests       |
| `npm run test:all`         | Run both unit + integration |
| `npm run lint`             | Alias for typecheck         |

Both `typecheck` and `lint` run `tsc --noEmit`. There is no separate ESLint pipeline.

---

## Testing patterns

All tests use `node:test` + `node:assert/strict`. Two tiers:

### Unit tests (`test/unit/*.test.ts`)

Pure-TS tests against modules in `src/`. They mock pi's `ExtensionAPI` surface with hand-built fakes — fast, deterministic, no pi runtime in the loop.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

test("dispatcher rejects unknown workflow", async () => {
  const result = await dispatcher.dispatch({ name: "missing", action: "run" });
  assert.equal(result.status, "failed");
});
```

Run: `npm run test:unit`.

### Integration tests (`test/integration/*.test.ts`)

Higher-fidelity tests that compose multiple modules (runtime, wiring, overlay) and exercise the extension factory against a structural mock of `ExtensionAPI`. Still no real pi process — but they cover end-to-end registration, lifecycle, and overlay paths.

Run: `npm run test:integration`.

### Improved coverage with pi's SDK (recommended for new end-to-end tests)

Pi exposes `DefaultResourceLoader.extensionFactories` for in-process extension injection. This is the highest-fidelity test path short of spawning a real `pi` process:

```ts
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import factory from "../src/extension/index.ts";

const resourceLoader = new DefaultResourceLoader({
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  extensionFactories: [factory],
});
await resourceLoader.reload();

const { session } = await createAgentSession({
  resourceLoader,
  sessionManager: SessionManager.inMemory(),
});
```

This pattern lets you assert against pi's real `ExtensionAPI`, real command dispatch, real tool registration, and real event bus — no manual mocks. It's the canonical pi pattern documented in [pi examples/sdk/06-extensions.ts](https://github.com/earendil-works/pi-mono/blob/main/examples/sdk/06-extensions.ts).

Add an integration test that exercises this for the `workflow` tool + `/workflow list` slash command and you'll catch ExtensionAPI shape drift before it ships.

### Quiet output for AI agents

`node:test`'s default reporter is already terse. For even less output:

```bash
npm run test:unit 2>&1 | grep "^ℹ"   # just pass/fail/duration summary
# or
npm run test:unit -- --test-reporter=tap
```

---

## Running examples

```bash
node --experimental-transform-types --import ./test/support/register-loader.mjs examples/hello-world.ts
node --experimental-transform-types --import ./test/support/register-loader.mjs examples/parallel-fan-out.ts
```

The `register-loader.mjs` hook rewrites `.js` → `.ts` at resolve time (TypeScript ESM convention).

---

## Project layout

```
.
├── install.mjs              # npx atomic-workflows entrypoint (post-publish convenience)
├── src/
│   ├── extension/           # Pi extension entry point: tool, slash commands, hooks
│   ├── intercom/            # pi-intercom adapter (HIL for detached runs)
│   ├── runs/
│   │   ├── foreground/      # Synchronous executor and stage runner
│   │   ├── background/      # Detached runner, cancellation registry, status helpers
│   │   └── shared/          # Concurrency, graph-inference, cli-flags
│   ├── shared/              # store, store-types, types, persistence-{compaction,restore,session-entries}
│   ├── tui/                 # Above-editor widget and DAG overlay
│   ├── workflows/           # defineWorkflow, createRegistry, identity helpers
│   └── index.ts             # Public entry point
├── workflows/               # Bundled workflow definitions
│   ├── deep-research-codebase.ts
│   ├── ralph.ts
│   ├── open-claude-design.ts
│   └── index.ts
├── test/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── support/             # ts-loader.mjs, register-loader.mjs, helpers.ts
├── examples/                # Runnable standalone examples
├── package.json
└── tsconfig.json
```

---

## Best practices

- **Source files use `.js` import extensions** (TypeScript ESM convention). The repo ships as `.ts` files; Node's loader + `test/support/ts-loader.mjs` rewrites `.js` → `.ts` at resolve time. Do not break this — pi's loader follows the same convention.
- **Avoid `any` and `unknown`.** Use specific types. The codebase compiles with `strict`, `noUnusedLocals`, `noUnusedParameters`.
- **Mirror `pi-subagents` conventions.** When in doubt about a structural choice (extension shape, manifest layout, file naming), check [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) first — both extensions follow the same ship-as-source pattern.
- **Track in-progress fixes in `issues.md`.** Delete the file once issues are resolved to keep the repo clean.

---

## Releasing

### Branch naming

- Release: `release/v<major>.<minor>.<patch>` (e.g. `release/v0.1.1`)
- Prerelease: `prerelease/v<major>.<minor>.<patch>-<prerelease>` (e.g. `prerelease/v0.1.1-0`)

### Workflow

1. Create a branch following the naming convention above.
2. Edit `package.json` to set the target version.
3. Commit with the message `chore(release): bump to v<version>`.
4. Open a PR to `main`.
5. Once merged, publish with `npm publish --provenance`.

Provenance is enabled in CI; no `NPM_TOKEN` is needed for OIDC-authenticated publishes. If you see steps configuring `NPM_TOKEN` / `NODE_AUTH_TOKEN` for publishing, they are mistakes — remove them.

---

## CI

CI runs typecheck and `test:all` on PRs. See `.github/workflows/`.

---

## Known issues

- A handful of unit tests in `test/unit/wiring.test.ts` assert against a stale ExtensionAPI mock shape and currently fail. Track in `issues.md` when you next pick this up.
