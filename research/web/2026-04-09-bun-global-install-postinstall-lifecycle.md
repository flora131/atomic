---
source_url: https://bun.com/docs/pm/lifecycle
fetched_at: 2026-04-09
fetch_method: playwright-cli
topic: Bun global install and postinstall lifecycle script behavior
---

# Bun Global Install & Postinstall Lifecycle Scripts

## TL;DR

**`bun add -g <pkg>` and `bun update -g <pkg>` do NOT run the installed package's `postinstall` script.**

This is confirmed directly in the Bun source code at:
`src/install/PackageManager/install_with_manager.zig`, line 916:

```zig
if (manager.options.do.run_scripts and install_root_dependencies and !manager.options.global) {
    if (manager.root_lifecycle_scripts) |scripts| {
        // root lifecycle scripts can run now that all dependencies are installed...
        try manager.spawnPackageLifecycleScripts(ctx, scripts, optional, output_in_foreground, null);
    }
}
```

The `!manager.options.global` condition **explicitly skips root lifecycle scripts for global installs**.

## How Bun handles lifecycle scripts

From official docs (https://bun.com/docs/pm/lifecycle):

> Unlike other npm clients, Bun does not execute arbitrary lifecycle scripts by default. Bun uses a "default-secure" approach.

### For project-local installs (`bun add`, `bun install`):

1. **Root package scripts** (`postinstall` in your own `package.json`) — run by default, unless `--ignore-scripts` is passed.
2. **Dependency scripts** — NEVER run by default. Only run if the dependency is listed in `trustedDependencies`.

From the `--ignore-scripts` flag description on both `bun add` and `bun update`:
> "Skip lifecycle scripts in the project's package.json (dependency scripts are never run)"

The parenthetical makes clear that dependency postinstalls never run regardless.

### For global installs (`bun add -g`, `bun update -g`):

- Root lifecycle scripts are **explicitly suppressed** via the `!manager.options.global` guard in `install_with_manager.zig:916`.
- Neither the installed package's own `postinstall` nor its dependencies' postinstalls run.

## Does `bun update -g` re-run postinstall?

No — `bun update` goes through the same install path. The `--ignore-scripts` flag description on `bun update` also reads: "Skip lifecycle scripts in the project's package.json (dependency scripts are never run)". And the same `!manager.options.global` guard applies.

## `--trust` flag

`bun add --trust <pkg>` adds a package to `trustedDependencies` and runs its scripts — but this is for project-local dependency scripts, not for global installs. There is no `--trust` workaround for global installs based on the source code.

## Key Source References

- `src/install/PackageManager/install_with_manager.zig` — line 916: global guard on root lifecycle scripts
- `src/install/PackageInstaller.zig` — line 1171: `if (resolution.tag != .root and (resolution.tag == .workspace or is_trusted))` — dependency scripts only run for non-root packages that are trusted
- `src/install/PackageManager/PackageManagerLifecycle.zig` — line 211: `loadRootLifecycleScripts` — loads root scripts but they are guarded upstream

## Official Docs

- Lifecycle scripts: https://bun.com/docs/pm/lifecycle
- `bun add` flags including `--trust`: https://bun.com/docs/pm/cli/add
- `bun update` flags: https://bun.com/docs/pm/cli/update
