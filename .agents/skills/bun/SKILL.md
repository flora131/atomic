---
name: Bun
description: Use when building, testing, or deploying JavaScript/TypeScript applications. Reach for Bun when you need to run scripts, install packages, bundle code, or test applications — it's a drop-in replacement for Node.js with integrated package manager, test runner, and bundler.
metadata:
    mintlify-proj: bun
    version: "1.0"
    internal: true
---

# Bun Skill Reference

## Product Summary

Bun is an all-in-one JavaScript/TypeScript toolkit that replaces Node.js, npm, and bundlers with a single fast binary. It includes a runtime (powered by JavaScriptCore), package manager, test runner, and bundler. Key files: `bunfig.toml` (configuration), `package.json` (scripts and dependencies), `bun.lock` (lockfile). Primary CLI commands: `bun run`, `bun install`, `bun test`, `bun build`. See https://bun.com/docs for comprehensive documentation.

## When to Use

- **Running scripts**: Execute `.js`, `.ts`, `.jsx`, `.tsx` files directly with `bun run` or `bun <file>` — no compilation step needed
- **Package management**: Install dependencies with `bun install` (25x faster than npm) or add packages with `bun add`
- **Testing**: Write and run Jest-compatible tests with `bun test` with TypeScript support built-in
- **Bundling**: Bundle applications for browsers or servers with `bun build` or `Bun.build()` API
- **HTTP servers**: Build servers with `Bun.serve()` API with native WebSocket and streaming support
- **Monorepos**: Manage workspaces with `bun install --filter` and run scripts across packages
- **Development**: Use watch mode (`--watch`) for live reloading during development
- **Deployment**: Compile standalone executables with `bun build --compile` or deploy to Vercel, Railway, etc.

## Quick Reference

### Essential Commands

| Task                 | Command                                              |
| -------------------- | ---------------------------------------------------- |
| Run a file           | `bun run index.ts` or `bun index.ts`                 |
| Run a script         | `bun run dev` (from package.json)                    |
| Install dependencies | `bun install`                                        |
| Add a package        | `bun add react` or `bun add -d @types/node`          |
| Remove a package     | `bun remove react`                                   |
| Run tests            | `bun test`                                           |
| Watch tests          | `bun test --watch`                                   |
| Build for browser    | `bun build ./index.tsx --outdir ./dist`              |
| Build for server     | `bun build ./index.tsx --outdir ./dist --target bun` |
| Watch build          | `bun build ./index.tsx --outdir ./dist --watch`      |
| Run with watch mode  | `bun --watch run index.ts`                           |
| Execute a package    | `bunx cowsay "Hello"`                                |

### Configuration Files

| File            | Purpose                                                       |
| --------------- | ------------------------------------------------------------- |
| `bunfig.toml`   | Bun-specific configuration (optional, zero-config by default) |
| `package.json`  | Project metadata, scripts, dependencies                       |
| `bun.lock`      | Lockfile (text-based, replaces package-lock.json)             |
| `tsconfig.json` | TypeScript configuration (Bun respects this)                  |

### Key bunfig.toml Sections

```toml
[install]
linker = "hoisted"  # or "isolated" for strict dependency isolation
dev = true          # install devDependencies
optional = true     # install optionalDependencies
peer = true         # install peerDependencies

[test]
root = "."
coverage = false
coverageThreshold = 0.9

[run]
shell = "system"    # or "bun" for Bun's shell
bun = true          # alias node to bun in scripts
```

### File Type Support

Bun natively transpiles and executes:
- `.js`, `.jsx` — JavaScript and JSX
- `.ts`, `.tsx` — TypeScript and TSX
- `.json`, `.jsonc`, `.toml`, `.yaml` — Data files (parsed at build time)
- `.html` — HTML with asset bundling
- `.css` — CSS bundling

## Decision Guidance

| Scenario                 | Use                                                     | Why                                                                         |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Package installation** | `bun install` vs `npm install`                          | Bun is 25x faster, uses global cache, supports workspaces                   |
| **Linker strategy**      | `--linker isolated` vs `--linker hoisted`               | Isolated prevents phantom dependencies; hoisted is traditional npm behavior |
| **Build target**         | `--target browser` vs `--target bun` vs `--target node` | Browser for web apps, bun for server code, node for Node.js compatibility   |
| **Module format**        | `--format esm` vs `--format cjs`                        | ESM is default; use CJS for CommonJS compatibility                          |
| **Watch mode**           | `--watch` vs manual restart                             | Use `--watch` for development; Bun uses OS-native file watchers (fast)      |
| **Test execution**       | `--concurrent` vs sequential                            | Concurrent for independent tests; sequential for tests with shared state    |
| **Bundling**             | `bun build` vs `Bun.build()` API                        | CLI for simple builds; API for programmatic control and in-memory bundling  |

## Workflow

### 1. Initialize a Project
```bash
bun init my-app
cd my-app
```
Choose template: Blank, React, or Library. Creates `package.json`, `tsconfig.json`, `bunfig.toml`.

### 2. Install Dependencies
```bash
bun install
# or add specific packages
bun add react
bun add -d @types/node typescript
```
Generates `bun.lock` lockfile. Use `--frozen-lockfile` in CI for reproducible builds.

### 3. Write Code
Create `.ts`, `.tsx`, `.js`, or `.jsx` files. Bun transpiles on the fly.

### 4. Run Code
```bash
bun run index.ts
# or with watch mode
bun --watch run index.ts
```

### 5. Add Scripts to package.json
```json
{
  "scripts": {
    "dev": "bun --watch run src/index.ts",
    "build": "bun build ./src/index.tsx --outdir ./dist",
    "test": "bun test",
    "start": "bun run dist/index.js"
  }
}
```

### 6. Run Scripts
```bash
bun run dev
bun run build
bun run test
```

### 7. Test
```bash
# Write tests in *.test.ts or *.spec.ts
bun test
bun test --watch
bun test --coverage
```

### 8. Bundle for Production
```bash
bun build ./src/index.tsx --outdir ./dist --minify
# or for a server
bun build ./src/server.ts --outdir ./dist --target bun --minify
```

### 9. Deploy
Commit `bun.lock` to version control. In CI, use `bun ci` (equivalent to `bun install --frozen-lockfile`).

## Common Gotchas

- **Watch mode flag placement**: Use `bun --watch run dev`, not `bun run dev --watch`. Flags after the script name are passed to the script itself.
- **Lifecycle scripts**: Bun does not execute `postinstall` scripts for security. Add packages to `trustedDependencies` in `package.json` to allow them.
- **Node.js compatibility**: Bun aims for Node.js compatibility but is not 100% complete. Check `/runtime/nodejs-compat` for current status.
- **TypeScript errors in Bun global**: Install `@types/bun` and configure `tsconfig.json` with `"lib": ["ESNext"]` and `"module": "Preserve"`.
- **Module resolution**: Bun supports both ESM and CommonJS. Use `import` for ESM (recommended) or `require()` for CommonJS.
- **Bundler is not a type checker**: Use `tsc` separately for type checking and `.d.ts` generation; `bun build` only transpiles.
- **Auto-install disabled in production**: Set `install.auto = "disable"` in `bunfig.toml` for production environments.
- **Phantom dependencies**: Use `--linker isolated` to prevent accidental imports of transitive dependencies.
- **Environment variables**: Bun auto-loads `.env`, `.env.local`, `.env.[NODE_ENV]`. Disable with `env = false` in `bunfig.toml`.
- **Minification by default for bun target**: When `target: "bun"`, identifiers are minified by default; use `minify: false` to disable.

## Verification Checklist

Before submitting work with Bun:

- [ ] Run `bun install` to ensure dependencies are locked
- [ ] Run `bun test` to verify all tests pass
- [ ] Run `bun run build` (or your build script) and verify output in `dist/` or configured `outdir`
- [ ] Test the built output: `bun run dist/index.js` or `node dist/index.js` (if targeting Node.js)
- [ ] Check `bun.lock` is committed to version control
- [ ] Verify `bunfig.toml` has correct configuration for your environment (dev vs. production)
- [ ] Run `bun run --filter <pattern> <script>` in monorepos to test workspace scripts
- [ ] For HTTP servers, test with `curl` or browser: `curl http://localhost:3000`
- [ ] For bundled apps, check bundle size: `ls -lh dist/`
- [ ] Verify no console errors or warnings in test output
- [ ] If using TypeScript, ensure `tsconfig.json` is properly configured

## Resources

- **Comprehensive navigation**: https://bun.com/docs/llms.txt — Full page-by-page listing for agent navigation
- **Runtime documentation**: https://bun.com/docs/runtime — Execute files, scripts, and use Bun APIs
- **Package manager**: https://bun.com/docs/pm/cli/install — Install, add, remove, and manage dependencies
- **Test runner**: https://bun.com/docs/test — Write and run Jest-compatible tests
- **Bundler**: https://bun.com/docs/bundler — Bundle for browsers and servers

---

> For additional documentation and navigation, see: https://bun.com/docs/llms.txt