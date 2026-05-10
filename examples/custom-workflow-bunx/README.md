# custom workflow source example

This example is now a direct-import workflow source for Atomic 2 daemon mode.
Legacy `bunx` subprocess discovery is removed: Atomic no longer calls `_emit-workflow-meta` or `_atomic-run`, and workflows should not call `hostLocalWorkflows`.

Register the source file directly in `.atomic/settings.json` or `~/.atomic/settings.json`:

```jsonc
{
  "workflows": {
    "explain-file": {
      "command": "/absolute/path/to/examples/custom-workflow-bunx/index.ts",
      "agents": ["claude"]
    }
  }
}
```

Then refresh and run:

```sh
atomic workflow refresh
atomic workflow -n explain-file -a claude --path src/cli.ts
```
