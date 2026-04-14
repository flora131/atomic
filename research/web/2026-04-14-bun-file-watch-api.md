---
source_url: https://bun.com/docs/guides/read-file/watch.md
fetched_at: 2026-04-14
fetch_method: markdown-accept-header
topic: Bun file/directory watching API
---

# Watch a directory for changes

Bun implements the `node:fs` module, including the `fs.watch` function for listening for file system changes.

## Shallow watch (callback style)

```ts
import { watch } from "fs";

const watcher = watch(import.meta.dir, (event, filename) => {
  console.log(`Detected ${event} in ${filename}`);
});
```

## Recursive watch

```ts
import { watch } from "fs";

const watcher = watch(import.meta.dir, { recursive: true }, (event, relativePath) => {
  console.log(`Detected ${event} in ${relativePath}`);
});
```

## Async iterator style (fs/promises)

```ts
import { watch } from "fs/promises";

const watcher = watch(import.meta.dir);
for await (const event of watcher) {
  console.log(`Detected ${event.eventType} in ${event.filename}`);
}
```

## Stop watching

```ts
watcher.close();
```

Source page also confirms: Bun uses OS-native watcher APIs (kqueue / inotify) — no polling.
No `Bun.watch()` API exists; `node:fs` `watch()` is the recommended approach.
