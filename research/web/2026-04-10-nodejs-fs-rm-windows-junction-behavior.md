---
source_url: multiple (Node.js/node, libuv/libuv, microsoft/STL, oven-sh/bun source + GitHub issues)
fetched_at: 2026-04-10
fetch_method: html-parse (raw GitHub URLs)
topic: Node.js fs.rm / fs.promises.rm behavior with Windows NTFS junctions
---

# Node.js `fs.rm` + Windows NTFS Junctions: Complete Research

## Summary

`fs.rm(path, { recursive: true })` on a Windows NTFS junction is **safe** in all current Node.js versions — it removes only the junction entry itself, not the contents of the target directory. However, the code path differs by version, and there have been related bugs. Bun has had confirmed bugs on this front.

---

## Node.js Implementation Paths by Version

### Node.js v14–v22 (all LTS): Async `fs.rm` / `fs.promises.rm` — JS rimraf path

File: `lib/internal/fs/rimraf.js`

The async and promise `rm` always use `rimraf()` (in all Node.js versions including v23+):

```
rimraf(path) →
  lstat(path) →
    if stats.isDirectory() → _rmdir() → rmdir() → if ENOTEMPTY → _rmchildren()
    else → unlink(path)
```

**Junction behavior via libuv `lstat`:**

From `libuv/libuv/src/win/fs.c` — `fs__stat_assign_statbuf()`:

```c
if (do_lstat && (stat_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
  statbuf->st_mode |= S_IFLNK;  // ← junction gets S_IFLNK, NOT S_IFDIR
}
```

For a standard NTFS junction pointing to `\??\C:\...`, libuv `lstat` returns `S_IFLNK` (symlink mode). So:

- `stats.isDirectory()` = **false**
- `stats.isSymbolicLink()` = **true**
- rimraf calls `unlink(path)` — removes just the junction

**libuv `unlink` on a junction** (from `fs__unlink_rmdir()`):

Opens with `FILE_FLAG_OPEN_REPARSE_POINT` (does not follow). If target has `FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT` and `readlink_handle()` succeeds (valid junction), deletion via `FILE_DISPOSITION_DELETE` is allowed. The junction entry is deleted, target is untouched.

**Conclusion (async path, all Node.js versions):** Safe — removes only the junction.

---

### Node.js v14–v22: Sync `fs.rmSync` — JS rimrafSync path

`lib/fs.js` (v22.x):

```js
function rmSync(path, options) {
  lazyLoadRimraf();
  return rimrafSync(getValidatedPath(path), validateRmOptionsSync(path, options, false));
}
```

`rimrafSync` calls `lstatSync` → same libuv path → junction gets `S_IFLNK` → `isDirectory()` = false → `_unlinkSync(path)` → removes just the junction.

**Conclusion (sync path, v14–v22):** Safe.

---

### Node.js v23+ (including v24, v25): Sync `fs.rmSync` — Native C++ path

Introduced by PR [#53617](https://github.com/nodejs/node/pull/53617), merged 2024-07-18, first in Node.js 23.0.0 (released 2024-10-16).

`lib/fs.js` (v23+):

```js
function rmSync(path, options) {
  const opts = validateRmOptionsSync(path, options, false);
  return binding.rmSync(getValidatedPath(path), opts.maxRetries, opts.recursive, opts.retryDelay);
}
```

Native C++ (`src/node_file.cc`):

```cpp
auto file_status = std::filesystem::symlink_status(file_path, error);
// ...
if (recursive) {
  std::filesystem::remove_all(file_path, error);
} else {
  std::filesystem::remove(file_path, error);
}
```

**Key: MSVC STL `symlink_status` for junctions returns `file_type::junction`** (not `file_type::directory`, not `file_type::symlink`).

From `microsoft/STL/stl/inc/filesystem`:
```cpp
if (_Stats._Reparse_point_tag == __std_fs_reparse_tag::_Mount_point) {
  this->type(file_type::junction);  // ← distinct type!
  return;
}
```

So `is_directory()` on a junction = **false** → the EISDIR guard is not triggered.

**`std::filesystem::remove_all` on a junction** (MSVC STL `stl/inc/filesystem`):

```cpp
uintmax_t remove_all(const path& _Path, error_code& _Ec) {
  const auto _First_remove_result = __std_fs_remove(_Path.c_str());
  // ...
  if (_First_remove_result._Error == __std_win_error::_Directory_not_empty) {
    _Remove_all_dir(_Path, _Ec, _Removed_count);  // Only called if dir is not empty
  }
}
```

`__std_fs_remove` opens with `FILE_FLAG_OPEN_REPARSE_POINT` (no follow) and deletes the entry directly. A junction is an atomic entry — `__std_fs_remove` succeeds immediately without returning `_Directory_not_empty`. `_Remove_all_dir` is never called. Target directory is untouched.

**Conclusion (sync path, v23+):** Safe.

**Caveat (fixed):** There was a bug in v24.12.0 (PR [#61020](https://github.com/nodejs/node/issues/61020)) where `rmSync` used `std::filesystem::status()` instead of `symlink_status()`, which follows symlinks. This caused broken symlinks/junctions to silently fail (no-op). Fixed in PR [#61040](https://github.com/nodejs/node/pull/61040), merged 2025-12-23. This was a no-op bug (wouldn't delete), not a data-destruction bug.

---

## Summary Table

| Node.js Version | `fs.rm` (async) | `fs.promises.rm` | `fs.rmSync` |
|---|---|---|---|
| v14–v22 | rimraf/libuv lstat → unlink ✅ | rimrafPromises ✅ | rimrafSync/libuv lstat → unlinkSync ✅ |
| v23+ | rimraf/libuv lstat → unlink ✅ | rimrafPromises ✅ | native C++ std::filesystem::remove_all ✅ |

In all cases: **junction is removed, target directory contents are untouched.**

---

## Bun's Implementation and Bugs

### Bun `fs.rm` (Node.js-compat)

Source: `src/bun.js/node/node_fs.zig`, `NodeFS.rm()`:

```zig
pub fn rm(this: *NodeFS, args: Arguments.Rm, _: Flavor) Maybe(Return.Rm) {
  if (args.recursive) {
    zigDeleteTree(std.fs.cwd(), args.path.slice(), .file) catch |err| { ... };
    return .success;
  }
  // non-recursive: std.posix.unlinkZ
}
```

**`zigDeleteTree` with `.file` kind hint:**
1. Calls `zigDeleteTreeOpenInitialSubpath(self, sub_path, .file)` with `treat_as_dir = false`
2. First tries `deleteFile(sub_path)` (which is `std.posix.unlinkZ`)
3. If that returns `error.IsDir`, sets `treat_as_dir = true`, then tries `openDir(sub_path, {no_follow: true})`

**Problem:** On Windows, `openDir` with `no_follow: true` still opens junction directories and iterates their **target** contents. This is a known Windows kernel behavior: even with `FILE_OPEN_REPARSE_POINT`, `NtQueryDirectoryFile` on a junction handle can dereference the junction for directory listing.

### Confirmed Bun Bug

Issue [#27233](https://github.com/oven-sh/bun/issues/27233) — "Windows: bun rm -f \<folder\> crashes (panic: invalid enum value) when folder contains a JUNCTION"

- **Crash**: Junction inside a directory caused `deleteFile` to be called with `FILE_NON_DIRECTORY_FILE`, Windows returned `STATUS_NOT_A_DIRECTORY`, unhandled errno caused panic.
- **Data destruction risk**: PR [#27251](https://github.com/oven-sh/bun/pull/27251) explicitly states: "rm -rf incorrectly recursing into junctions/directory symlinks and **deleting the target directory's contents**"
- **Status**: As of April 2026, PRs [#27245](https://github.com/oven-sh/bun/pull/27245) and [#27251](https://github.com/oven-sh/bun/pull/27251) are still **open** (not merged).

**Bun `fs.rm({ recursive: true })` on a Windows junction is potentially unsafe as of Bun v1.3.9+ — it may follow the junction and delete the target's contents, or panic.**

For the **shell** `$\`rm -rf\``, the same crash was confirmed.

---

## Safe Junction Removal on Windows

### Option 1: `fs.unlink` (safest — libuv path, all versions)

`fs.unlink` / `fs.promises.unlink` calls libuv `fs__unlink` → `fs__unlink_rmdir(isrmdir=false)`:
- Opens with `FILE_FLAG_OPEN_REPARSE_POINT` (does not follow)
- Checks `FILE_ATTRIBUTE_REPARSE_POINT` — if it's a valid symlink/junction, allows deletion
- Deletes the junction entry atomically

**Limitation:** `fs.unlink` on a non-symlink directory returns `EPERM` on POSIX. On Windows it also rejects plain directories (non-reparse-point). So it is safe to use for junctions specifically.

```ts
import { unlink } from 'node:fs/promises';
await unlink(junctionPath); // Safe on Windows, removes only the junction
```

### Option 2: `fs.rm(path, { recursive: false })` (Node.js only, not Bun-safe)

Without `recursive: true`, `fs.rmSync` in v23+ uses `std::filesystem::remove()` (not `remove_all`). On a junction this still removes the junction safely since `__std_fs_remove` opens with `OPEN_REPARSE_POINT`.

But this is equivalent to `unlink` with extra overhead, and `force: true` may suppress the error if the junction is already gone.

### Recommended Pattern (cross-platform, cross-runtime safe)

```ts
import fs from 'node:fs/promises';

async function removeJunctionSafely(junctionPath: string): Promise<void> {
  try {
    // Check it's actually a symlink/junction (lstat doesn't follow)
    const stat = await fs.lstat(junctionPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(junctionPath);
    } else {
      // It's already a real directory or file — handle differently
      await fs.rm(junctionPath, { recursive: true, force: true });
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
```

### Why `fs.unlink` is safer than `fs.rm` for junctions

| Method | Mechanism | Junction safety |
|---|---|---|
| `fs.unlink` | libuv → `FILE_OPEN_REPARSE_POINT` + `DELETE` | Always safe — removes junction only |
| `fs.rm({ recursive: false })` | rimraf → unlink (v14–22) or native remove (v23+) | Safe in Node.js; uncertain in Bun |
| `fs.rm({ recursive: true })` | rimraf → unlink (v14–22) or remove_all (v23+) | Safe in Node.js; **unsafe in Bun** |
| `fs.rmdir` | libuv → rmdir (for directories) | Works on junctions but semantically odd |

---

## References

- Node.js `lib/internal/fs/rimraf.js`: https://github.com/nodejs/node/blob/main/lib/internal/fs/rimraf.js
- Node.js `src/node_file.cc` (RmSync): https://github.com/nodejs/node/blob/main/src/node_file.cc
- PR #53617 — moved rmSync to C++: https://github.com/nodejs/node/pull/53617
- PR #61040 — fix broken symlinks in rmSync: https://github.com/nodejs/node/pull/61040
- Issue #61020 — rmSync broken symlink bug in v24.12.0: https://github.com/nodejs/node/issues/61020
- libuv `src/win/fs.c`: https://github.com/libuv/libuv/blob/v1.x/src/win/fs.c
- MSVC STL `stl/inc/filesystem`: https://github.com/microsoft/STL/blob/main/stl/inc/filesystem
- MSVC STL `stl/src/filesystem.cpp`: https://github.com/microsoft/STL/blob/main/stl/src/filesystem.cpp
- Bun issue #27233 — junction rm crash: https://github.com/oven-sh/bun/issues/27233
- Bun PR #27245 — fix junction dir_iterator: https://github.com/oven-sh/bun/pull/27245
- Bun PR #27251 — fix shell rm on junctions: https://github.com/oven-sh/bun/pull/27251
- Bun `src/bun.js/node/node_fs.zig`: https://github.com/oven-sh/bun/blob/main/src/bun.js/node/node_fs.zig
