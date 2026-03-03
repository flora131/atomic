# Bun-Native Alternatives to Node.js APIs

> **Research Date:** 2024
> **Repository:** oven-sh/bun
> **Purpose:** Document Bun-native alternatives to Node.js APIs for migration and optimization

This document provides a comprehensive overview of Bun's built-in APIs and their advantages over Node.js equivalents, based on research of the oven-sh/bun repository via DeepWiki.

---

## Table of Contents

1. [SQLite Module (bun:sqlite)](#1-sqlite-module-bunsqlite)
2. [Process Spawning (Bun.spawn)](#2-process-spawning-bunspawn)
3. [File I/O (Bun.file & Bun.write)](#3-file-io-bunfile--bunwrite)
4. [Path Utilities](#4-path-utilities)
5. [Process Management](#5-process-management)
6. [Compilation Feature](#6-compilation-feature)
7. [Module Resolution & Import Performance](#7-module-resolution--import-performance)
8. [Node.js Compatibility](#8-nodejs-compatibility)
9. [Startup Time Advantages](#9-startup-time-advantages)
10. [Known Migration Issues](#10-known-migration-issues)

---

## 1. SQLite Module (bun:sqlite)

### Overview
Bun's built-in SQLite module (`bun:sqlite`) provides a high-performance, synchronous API for interacting with SQLite3 databases. The API is inspired by `better-sqlite3` and is designed to be 3-6x faster.

### API Surface

#### Database Connection
```typescript
import { Database } from "bun:sqlite";

// File-based database
const db = new Database("mydb.sqlite");

// In-memory database
const inMemoryDb = new Database(":memory:");

// Read-only mode
const readOnlyDb = new Database("mydb.sqlite", { readonly: true });

// Import attribute syntax
import myDb from "./my.db" with { type: "sqlite" };
```

**Constructor Options:**
- `readonly`: Open in read-only mode
- `create`: Create if not exists
- `readwrite`: Read-write mode
- `safeIntegers`: Use BigInt for integers
- `strict`: Enable strict mode

#### Querying and Statements

```typescript
// Prepare and cache query
const query = db.query("SELECT 'Hello world' as message;");
query.get(); // Execute for single row

// Parameterized queries
db.query('SELECT * FROM users WHERE name = ?').all('John');

// Named parameters (supports $name, :name, @name)
db.query('SELECT * FROM users WHERE name = $name').all({ $name: 'John' });

// Execute without caching
db.run("CREATE TABLE foo (bar TEXT)");
db.run("INSERT INTO foo VALUES (?)", ["baz"]);

// Execute multiple statements
db.exec("CREATE TABLE...; INSERT INTO...; UPDATE...");
```

**Statement Methods:**
- `get()`: Return single row
- `all()`: Return all rows
- `run()`: Execute command (INSERT, UPDATE, DELETE)

#### Transactions

```typescript
const insertManyCats = db.transaction((cats: Array<{ $name: string; $age: number }>) => {
  for (const cat of cats) insert.run(cat);
});

insertManyCats([
  { $name: "Fluffy", $age: 3 },
  { $name: "Whiskers", $age: 5 }
]);
```

#### Serialization & Deserialization

```typescript
// Serialize database to Uint8Array
const contents = olddb.serialize();

// Deserialize from Uint8Array
const newdb = Database.deserialize(contents);
```

#### Extensions & Performance Features

```typescript
// Load SQLite extension
db.loadExtension("myext");

// Enable WAL mode for better performance
db.run("PRAGMA journal_mode = WAL;");
```

#### Embedding in Executables

```typescript
// Embed database in compiled executable
import myEmbeddedDb from "./my.db" with { type: "sqlite", embed: "true" };
```

**Note:** In compiled executables, embedded databases are read-write but changes are in-memory only and lost on exit.

### Performance Characteristics

- **3-6x faster** than `better-sqlite3` for read queries
- **8-9x faster** than `deno.land/x/sqlite` for read queries
- Native implementation in Bun for optimal performance
- Synchronous API eliminates Promise overhead

### Comparison to Node.js Libraries

**vs. better-sqlite3:**
- Similar API (easy migration)
- Significantly faster performance
- Native to Bun (no compilation needed)
- Bun actively discourages using `better-sqlite3`, throwing errors if `better-sqlite3.node` is encountered

**vs. node-sqlite3:**
- Synchronous vs. async (node-sqlite3 is callback-based)
- Much simpler API (no callback handling)
- Better performance

### ORM Support
Bun's SQLite module is used by ORMs like Drizzle, providing a solid foundation for type-safe database operations.

### Related: Bun.sql
Bun also provides `Bun.sql`, a unified Promise-based API for various SQL databases (SQLite, PostgreSQL, MySQL). While `Bun.sql` can interact with SQLite, `bun:sqlite` offers a direct, synchronous, and higher-performance interface specifically for SQLite3.

---

## 2. Process Spawning (Bun.spawn)

### Overview
`Bun.spawn()` and `Bun.spawnSync()` are Bun's APIs for spawning child processes, implemented using `posix_spawn(3)` for high performance. They provide approximately **60% faster** process spawning than Node.js's `child_process` module.

### API Surface

#### Bun.spawn() - Asynchronous

```typescript
// Basic usage
const proc = Bun.spawn(["bun", "--version"]);
console.log(await proc.exited); // 0

// With options
const proc = Bun.spawn(["node", "script.js"], {
  cwd: "./project",
  env: { NODE_ENV: "production" },
  onExit: (proc, exitCode, signalCode, error) => {
    console.log(`Process exited with code ${exitCode}`);
  },
  lazy: true, // Defer reading stdout/stderr
});

// Access streams
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
```

**Subprocess Properties:**
- `pid`: Process ID
- `exited`: Promise that resolves with exit code
- `stdin`: WritableStream or FileSink
- `stdout`: ReadableStream or FileSink
- `stderr`: ReadableStream or FileSink

#### Bun.spawnSync() - Synchronous

```typescript
// Basic usage
const proc = Bun.spawnSync(["echo", "hello"]);
console.log(proc.stdout.toString()); // "hello\n"

// With options
const proc = Bun.spawnSync(["node", "script.js"], {
  cwd: "./project",
  env: { NODE_ENV: "production" },
  maxBuffer: 1024 * 1024, // Kill if output exceeds 1MB
});

// Check results
if (proc.success) {
  console.log("Command succeeded");
  console.log(proc.stdout.toString());
} else {
  console.error("Command failed with code:", proc.exitCode);
  console.error(proc.stderr.toString());
}
```

**SyncSubprocess Properties:**
- `success`: Boolean (true if exit code is 0)
- `stdout`: Buffer
- `stderr`: Buffer
- `exitCode`: Number
- No `stdin` property (synchronous execution)

### Advanced Features

#### Pseudo-Terminal (PTY) Support (POSIX only)

```typescript
const proc = Bun.spawn(["vim"], {
  terminal: true, // Spawn with PTY attached
  stdout: "inherit",
});
```

Makes the subprocess think it's running in a real terminal, useful for interactive applications.

#### Inter-Process Communication (IPC)

```typescript
// Parent process
const proc = Bun.spawn(["bun", "child.js"], {
  ipc: (message) => {
    console.log("Received from child:", message);
  },
  serialization: "json", // Use "json" for Node.js compatibility
});

proc.send({ type: "greeting", data: "Hello!" });

// Child process (child.js)
process.on("message", (message) => {
  console.log("Received from parent:", message);
  process.send({ type: "reply", data: "Hi back!" });
});
```

**IPC Serialization:**
- Default: `"advanced"` (uses JSC's serialize API, supports more types)
- Node.js compatible: `"json"` (use this for compatibility)

### Comparison to Node.js child_process

#### Similarities
- Both provide `spawn` (async) and `spawnSync` (sync)
- Similar options: `cwd`, `env`, `stdio`
- IPC functionality mirrors Node.js's `child_process.fork()`

#### Differences

| Feature | Bun | Node.js |
|---------|-----|---------|
| Return type | `Subprocess` with `ReadableStream` | `ChildProcess` with Node streams |
| Performance | ~60% faster (posix_spawn) | Slower (fork + exec) |
| `lazy` option | ✅ Defer pipe reading | ❌ Not available |
| `terminal` option | ✅ PTY support | ❌ No direct equivalent |
| IPC serialization | Advanced (JSC) or JSON | JSON only |
| Benchmark (echo hi) | 888.14 µs | 1.47 ms |

#### Node.js Functions Not Directly Equivalent
- `exec()` / `execSync()`: Execute commands in shell
- `execFile()` / `execFileSync()`: Execute file directly
- `fork()`: Specialized Node.js module execution

Use `Bun.spawn()` with appropriate shell commands to replicate these.

### Performance Characteristics

**Underlying Implementation:**
- Uses `posix_spawn(3)` system call
- Avoids duplicating parent process memory space
- Faster than fork() + exec() approach

**Optimizations:**
- Isolated event loop for `spawnSync` to prevent interference
- Thread blocking for simple `spawnSync` calls (no IPC, timeout, etc.)
- Lazy stream reading option to reduce unnecessary I/O

**Benchmark Results:**
- Approximately **60% faster** than Node.js
- Example: `echo hi` takes 888.14 µs (Bun) vs. 1.47 ms (Node.js)

---

## 3. File I/O (Bun.file & Bun.write)

### Overview
Bun provides optimized APIs for file I/O with `Bun.file()` for reading and `Bun.write()` for writing. These use the fastest available system calls and can be **2x faster** than traditional tools like GNU `cat`.

### Bun.file() - Reading Files

#### Creating BunFile Instances

```typescript
import { file } from "bun";

// From file path
const f = Bun.file("./package.json");

// From file descriptor
const f = Bun.file(3); // stdin

// From file:// URL
const f = Bun.file(new URL("file:///path/to/file.txt"));
```

**BunFile is lazy** - file contents are not read until explicitly requested.

#### Reading File Contents

```typescript
const f = Bun.file("./data.json");

// Read as text
const text = await f.text();

// Read as JSON
const data = await f.json();

// Read as ArrayBuffer
const buffer = await f.arrayBuffer();

// Read as Uint8Array
const bytes = await f.bytes();

// Stream the file
const stream = f.stream();
for await (const chunk of stream) {
  console.log(chunk);
}
```

#### BunFile Properties & Methods

```typescript
const f = Bun.file("./file.txt");

// Properties
console.log(f.size);      // File size in bytes
console.log(f.type);      // MIME type
console.log(await f.exists()); // Check if file exists

// Methods
const slice = f.slice(0, 100);     // Get portion of file
const stats = await f.stat();       // Get file stats
await f.unlink();                   // Delete file
await f.delete();                   // Alias for unlink()
```

### Bun.write() - Writing Files

#### Basic Usage

```typescript
// Write string
await Bun.write("./file.txt", "Hello, world!");

// Write Blob
await Bun.write("./file.txt", new Blob(["data"]));

// Write ArrayBuffer
await Bun.write("./file.bin", buffer);

// Write TypedArray
await Bun.write("./file.bin", new Uint8Array([1, 2, 3]));

// Write Response
const response = await fetch("https://example.com/data.json");
await Bun.write("./data.json", response);

// Write BunFile (copy file)
await Bun.write("./dest.txt", Bun.file("./src.txt"));
```

#### With Options

```typescript
await Bun.write("./file.txt", "data", {
  createPath: true,  // Create parent directories if needed
  mode: 0o644,       // Set file permissions
});
```

#### Incremental Writing with FileSink

```typescript
const file = Bun.file("./large-file.txt");
const writer = file.writer();

// Write chunks
writer.write("chunk 1\n");
writer.write("chunk 2\n");
writer.write("chunk 3\n");

// Flush to disk
await writer.flush();

// End and close
await writer.end();

// With highWaterMark for buffer size
const writer = file.writer({ highWaterMark: 1024 * 1024 }); // 1MB buffer
```

### Standard I/O as BunFile

```typescript
// Write to stdout
await Bun.write(Bun.stdout, "Hello!\n");

// Write to stderr
await Bun.write(Bun.stderr, "Error!\n");

// Read from stdin
const input = await Bun.stdin.text();

// Copy file to stdout (faster cat implementation)
await Bun.write(Bun.stdout, Bun.file("./file.txt"));
```

### Comparison to node:fs

#### Performance Benefits
- **2x faster** than GNU `cat` for large files on Linux
- Uses fastest available system calls per platform
- Zero-copy operations where possible
- Optimized for various input/output permutations

#### API Differences

| Feature | Bun | node:fs |
|---------|-----|---------|
| Reading | Lazy `BunFile` (Blob interface) | Immediate read with callbacks/promises |
| Writing | Unified `Bun.write()` | Multiple functions (writeFile, createWriteStream) |
| Streams | Web Streams API | Node.js Streams |
| Standard I/O | Exposed as `BunFile` | Separate file descriptors |
| Type safety | TypeScript-first | Varies by implementation |

#### When to Use node:fs
For operations not yet available in Bun's APIs, use `node:fs`:
- `mkdir()` / `mkdirSync()` - Create directories
- `readdir()` / `readdirSync()` - List directory contents
- `rename()` / `renameSync()` - Rename files
- Other filesystem operations

Bun provides nearly complete `node:fs` implementation for compatibility, but `Bun.file()` and `Bun.write()` are recommended for file I/O operations.

### Web API Compatibility

```typescript
// BunFile extends Blob, so it works with Web APIs
const file = Bun.file("./data.json");

// Use with Response
const response = new Response(file);

// Use with FormData
const formData = new FormData();
formData.append("file", file);

// Stream over HTTP
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response(Bun.file("./large-video.mp4"));
  },
});
```

---

## 4. Path Utilities

### Overview
Bun provides path utilities primarily through its compatibility layer with Node.js, implementing the `node:path` module with **100% test suite compatibility**. Additionally, Bun exposes path-related information via `import.meta` for the current module.

### Node.js Compatibility (node:path)

Bun fully implements the `node:path` module with all standard Node.js path functions:

```typescript
import path from "node:path";

// All Node.js path functions work
path.join("/foo", "bar", "baz");      // "/foo/bar/baz"
path.resolve("./relative/path");       // Absolute path
path.dirname("/foo/bar/baz.txt");     // "/foo/bar"
path.basename("/foo/bar/baz.txt");    // "baz.txt"
path.extname("file.txt");             // ".txt"
path.parse("/home/user/file.txt");    // Parsed path object
path.normalize("/foo/../bar");         // "/bar"
path.relative("/foo/bar", "/foo/baz"); // "../baz"
path.isAbsolute("/foo/bar");          // true
```

**Platform-specific paths:**
```typescript
import path from "node:path";

// Windows-style paths
path.win32.join("C:\\foo", "bar");    // "C:\\foo\\bar"

// POSIX-style paths
path.posix.join("/foo", "bar");       // "/foo/bar"
```

### Bun-Native: import.meta Properties

Bun provides direct access to module path information via `import.meta`:

```typescript
// Current module file path information
console.log(import.meta.url);      // "file:///path/to/module.js"
console.log(import.meta.path);     // "/path/to/module.js"
console.log(import.meta.dir);      // "/path/to" (no trailing slash)
console.log(import.meta.filename); // "/path/to/module.js" (alias for path)
console.log(import.meta.dirname);  // "/path/to" (alias for dir)
```

**Benefits:**
- No import required
- Direct property access
- Consistent across all modules
- TypeScript-first design

### Implementation Details

Bun's `node:path` module is natively implemented in Bun's core (see `src/bun.js/node.zig` and `./node/path.zig`), not a wrapper around Node.js. This means:
- 100% API compatibility
- Native performance
- No dependency on Node.js

Bun also uses its own internal path utilities (e.g., `bun.path.joinAbsStringBuf`) for module resolution and other internal operations.

### Best Practices

**For module-relative paths:**
```typescript
// Use import.meta (no import needed)
const configPath = path.join(import.meta.dir, "config.json");
```

**For general path manipulation:**
```typescript
// Use node:path (full Node.js compatibility)
import path from "node:path";
const fullPath = path.resolve("./relative/path");
```

**For __dirname and __filename replacement:**
```typescript
// CommonJS equivalents (also available as globals in CommonJS modules)
const __dirname = import.meta.dirname;
const __filename = import.meta.filename;
```

---

## 5. Process Management

### Overview
Bun manages processes through `Bun.spawn()` and `Bun.spawnSync()` APIs, while providing Node.js-compatible `process` global with some Bun-specific enhancements.

### process.env

#### Basic Usage
```typescript
// Access environment variables (Node.js compatible)
console.log(process.env.NODE_ENV);
console.log(process.env.PATH);

// Bun alias
console.log(Bun.env.NODE_ENV); // Same as process.env
```

#### Automatic .env Loading
Bun automatically loads environment variables from `.env` files:

```bash
# Bun loads these files automatically (in order of precedence):
# 1. .env.local (highest precedence)
# 2. .env.{environment} (e.g., .env.production, .env.development)
# 3. .env
```

```typescript
// No need to use dotenv package
// Variables are automatically available in process.env
```

#### Modifying Environment Variables

```typescript
// Writable and deletable
process.env.MY_VAR = "value";
delete process.env.MY_VAR;

// Runtime changes aren't automatically reflected in child processes
// Must explicitly pass process.env when spawning
const proc = Bun.spawn(["command"], {
  env: process.env, // Pass current environment
});
```

#### Platform Differences

**Windows:**
- Environment variables are case-insensitive
- `process.env.PATH` and `process.env.path` refer to the same variable

### process.cwd()

```typescript
// Get current working directory
const cwd = process.cwd();
console.log(cwd); // "/home/user/project"

// Change working directory
process.chdir("/tmp");
console.log(process.cwd()); // "/tmp"
```

**Internal Handling:**
- Bun's `setCwd` function (in `src/bun.js/node/node_process.zig`) updates both the OS-level CWD and Bun's internal bundler state

### process.argv

```typescript
// Command-line arguments
console.log(process.argv);
// ["bun", "/path/to/script.js", "arg1", "arg2"]

// Also available as Bun.argv (deep strictly equal and cached)
console.log(Bun.argv === process.argv); // true
```

**Standalone Executables:**
- `process.argv[0]` is "bun" or the executable path
- Arguments are processed to ensure `process.argv.slice(2)` patterns work correctly

**Implementation:**
- The `createArgv` function in `src/bun.js/node/node_process.zig` constructs the `process.argv` array
- Includes flags passed to Bun itself

### Additional Process Properties

#### Process Identification

```typescript
// Distinguish Bun from Node.js
if (process.isBun) {
  console.log("Running in Bun!");
}

// Process ID
console.log(process.pid);

// Process title
process.title = "my-app";
console.log(process.title);
```

#### High-Resolution Time

```typescript
// High-resolution time measurement
const start = process.hrtime();
// ... do work ...
const [seconds, nanoseconds] = process.hrtime(start);
console.log(`Took ${seconds}s ${nanoseconds}ns`);

// BigInt version
const startBigInt = process.hrtime.bigint();
// ... do work ...
const elapsed = process.hrtime.bigint() - startBigInt;
console.log(`Took ${elapsed}ns`);
```

#### Release Information

```typescript
console.log(process.release);
// { name: "node" } - for compatibility
```

### Subprocess Management

See [Section 2: Process Spawning (Bun.spawn)](#2-process-spawning-bunspawn) for detailed information on:
- `Bun.spawn()` - Asynchronous process creation
- `Bun.spawnSync()` - Synchronous process creation
- IPC (Inter-Process Communication)
- PTY (Pseudo-Terminal) support
- Process lifecycle management

### Differences from Node.js

| Feature | Bun | Node.js |
|---------|-----|---------|
| `.env` loading | ✅ Automatic | ❌ Requires dotenv package |
| `process.isBun` | ✅ Available | ❌ Not available |
| `Bun.env` alias | ✅ Available | ❌ Not available |
| Environment precedence | .env.local > .env.{env} > .env | Depends on dotenv config |
| Subprocess API | `Bun.spawn()` / `Bun.spawnSync()` | `child_process` module |

---

## 6. Compilation Feature

### Overview
Bun's `bun build --compile` feature generates a standalone executable from JavaScript or TypeScript applications, embedding code and the Bun runtime into a single binary. This significantly improves startup performance by moving parsing and transpilation overhead from runtime to build-time.

### Basic Usage

```bash
# Compile a script to executable
bun build --compile ./index.ts --outfile myapp

# Run the executable
./myapp

# Cross-compile for different platforms
bun build --compile ./index.ts --target=bun-linux-x64 --outfile myapp-linux
bun build --compile ./index.ts --target=bun-darwin-arm64 --outfile myapp-macos
bun build --compile ./index.ts --target=bun-windows-x64 --outfile myapp.exe
```

### API Usage

```typescript
// Using Bun.build() API
await Bun.build({
  entrypoints: ["./index.ts"],
  compile: true,
  outfile: "myapp",
  target: "bun",
});

// With detailed configuration
await Bun.build({
  entrypoints: ["./index.ts"],
  compile: {
    target: "bun-linux-x64",
    minify: true,
  },
  outfile: "myapp",
});
```

### Compilation Options

#### Target Platforms

```bash
# Available targets
bun-linux-x64
bun-linux-arm64
bun-darwin-x64
bun-darwin-arm64
bun-windows-x64
```

#### Build-time Constants

```bash
# Define constants at compile time
bun build --compile --define 'API_URL="https://api.example.com"' ./app.ts
```

```typescript
// In your code
console.log(API_URL); // "https://api.example.com" at runtime
```

#### Bytecode Caching

```bash
# Enable bytecode for faster startup
bun build --compile --bytecode ./index.ts --outfile myapp
```

**Benefits:**
- Pre-compiles JavaScript to bytecode
- 1.5x to 4x faster startup
- Particularly beneficial for large applications
- Most effective with --compile (embedded in executable)

**Limitations:**
- Bytecode not portable across Bun versions
- Must regenerate when upgrading Bun
- Falls back to parsing if version mismatch

#### Automatic Configuration Loading

```bash
# Embed and auto-load .env file
bun build --compile --env-file .env ./app.ts

# Embed bunfig.toml
bun build --compile --bunfig bunfig.toml ./app.ts
```

### Production Mode

```bash
# --compile implies --production
bun build --compile ./app.ts

# Equivalent to:
NODE_ENV=production bun build --compile --minify ./app.ts
```

**Production mode sets:**
- `NODE_ENV=production`
- Minification enabled by default
- Dead code elimination
- Optimizations enabled

### Limitations

The `--compile` feature has several constraints:

**Not Supported:**
- `--outdir` (use `--outfile` instead, except with `--splitting`)
- `--public-path`
- `--target=node` or `--target=browser`
- `--no-bundle` (always bundles everything)

**Entrypoints:**
- Generally accepts only a single entrypoint
- Exception: Multiple entrypoints allowed with `--splitting`

**Bytecode Portability:**
- Generated bytecode is Bun version-specific
- Must regenerate when updating Bun
- Silent fallback to source parsing if mismatch

### Embedding SQLite Databases

```typescript
// Import with embed attribute
import myEmbeddedDb from "./my.db" with { type: "sqlite", embed: "true" };

// Database is embedded in the compiled executable
await Bun.build({
  entrypoints: ["./app.ts"],
  compile: true,
  outfile: "myapp",
});
```

**Behavior:**
- Database contents included in executable
- Read-write access in memory
- Changes lost on exit (not persisted to disk)
- Useful for configuration databases or reference data

### Startup Time Impact

**Without Compilation:**
- Parse source code at runtime
- Transpile TypeScript
- Generate bytecode
- Execute code

**With --compile:**
- ✅ Parsing moved to build-time
- ✅ Transpilation moved to build-time
- ✅ Code optimization at build-time
- ✅ Smaller runtime overhead

**With --compile --bytecode:**
- ✅ All above benefits
- ✅ Bytecode generation moved to build-time
- ✅ 1.5x to 4x faster startup
- ✅ Skip parsing entirely for ESM modules

### Use Cases

**Ideal for:**
- CLI tools (fast startup critical)
- Build tools (distributed without dependencies)
- Standalone applications (no runtime installation)
- Scripts that run frequently (startup time matters)
- Deployment to environments without Bun

**Example:**
```bash
# Create a fast CLI tool
bun build --compile --bytecode ./cli.ts --outfile mycli

# Distribute single binary (no dependencies needed)
./mycli --help  # Starts in milliseconds
```

### Comparison to Alternatives

| Approach | Startup Time | Distribution | Dependencies |
|----------|--------------|--------------|--------------|
| `node script.js` | Slow | Source files | Node.js required |
| `bun script.ts` | Fast | Source files | Bun required |
| `bun build --compile` | Very Fast | Single binary | None |
| `bun build --compile --bytecode` | Fastest | Single binary | None |

---

## 7. Module Resolution & Import Performance

### Overview
Bun's module resolution is designed for speed and Node.js compatibility, featuring auto-installation, bytecode caching, and multi-threaded bundling. The system supports both ESM and CommonJS modules with a plugin system for custom behaviors.

### Module Resolution Algorithm

#### Basic Resolution

```typescript
// Bun.resolve() and Bun.resolveSync() for manual resolution
const resolved = Bun.resolveSync("./module.ts", process.cwd());
console.log(resolved); // "/absolute/path/to/module.ts"

// Async version
const resolvedAsync = await Bun.resolve("package-name");
```

#### Resolution Process

1. **Built-in Modules**: Check for special prefixes
   ```typescript
   import path from "node:path";  // Node.js built-in
   import { db } from "bun:sqlite"; // Bun built-in
   ```

2. **Package.json exports**: Consider `exports` field for ESM packages
   ```json
   {
     "exports": {
       ".": "./dist/index.js",
       "./utils": "./dist/utils.js"
     }
   }
   ```

3. **Symlink Resolution**: Attempt to resolve paths without symlinks first

4. **Plugin Hooks**: Allow custom resolution via `onResolve` hooks

5. **Fallback**: Use Bun's auto-installation if `node_modules` not found

### Auto-Installation

**When `node_modules` is not present**, Bun automatically installs packages into a global cache:

```typescript
// No node_modules? No problem!
import cowsay from "cowsay"; // Auto-installs from npm

console.log(cowsay.say({ text: "Hello!" }));
```

#### Version Resolution Strategy

1. Check `bun.lock` for locked version
2. Check `package.json` for version range
3. Default to `latest` if not specified

#### Cache Behavior

```bash
# Global cache location
~/.bun/install/cache/

# Cache structure
<cache>/<pkg>@<version>/
```

**Process:**
1. Check module cache for compatible version
2. Download from npm if not in cache
3. Install to global cache
4. Make available to application

#### Version Specification in Imports

```typescript
// Specify exact version (short-circuits resolution)
import foo from "foo@1.2.3";

// Specify version range
import bar from "bar@^2.0.0";
```

### Import System

Bun internally uses ESM for modules and supports various import kinds:

```typescript
// Standard import statement
import { foo } from "./module";

// Dynamic import
const module = await import("./module");

// require() call (CommonJS)
const module = require("./module");

// Import in CSS
@import url("./styles.css");

// URL token
background: url("./image.png");
```

### Performance Optimizations

#### 1. Bytecode Caching

**Pre-compile JavaScript to bytecode at build time:**

```bash
# Enable bytecode caching
bun build ./index.ts --target=bun --bytecode --outdir=./dist
```

**How it works:**
- Parse source code once at build time
- Generate bytecode during build
- Skip parsing at runtime
- Load pre-compiled bytecode directly

**Performance impact:**
- Skip lazy parsing overhead
- All functions pre-compiled
- 1.5x to 4x faster startup
- Larger applications benefit more

**Usage at runtime:**
```bash
# Bun automatically detects and uses .jsc files
bun run ./dist/index.js  # Uses index.jsc if available
```

#### 2. Multi-Threading

Bun's bundler uses multiple threads for performance:

- **JS Thread**: Main JavaScript execution
- **Bundle Thread**: Coordination and bundling
- **Parse Workers**: Parallel parsing of modules
- **WorkPool**: CPU-intensive tasks (minification, etc.)

#### 3. Zig Implementation

- Written in Zig (high performance, low-level control)
- Powered by JavaScriptCore (fast startup)
- Dramatically reduced startup times and memory usage

#### 4. Optimized Bundling

```typescript
// Create optimized bundles with Bun.build()
await Bun.build({
  entrypoints: ["./app.ts"],
  target: "bun", // Optimize for Bun runtime
  format: "esm",
  outdir: "./dist",
  splitting: true, // Code splitting
  minify: true,    // Minification
});
```

**When `target: "bun"`:**
- Bundles marked to bypass re-transpilation
- Reduced startup times
- Improved running performance
- Server-side optimizations

### Tips for Maximizing Import Performance

#### 1. Leverage Auto-Install for Simple Scripts

```typescript
// Remove node_modules for quick scripts
// Let Bun auto-install on demand
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.listen(3000);
```

**Benefits:**
- No `npm install` step
- Faster initial setup
- Global caching across projects

#### 2. Use Bytecode Caching for Production

```bash
# Build with bytecode for production
bun build --target=bun --bytecode --outdir=./dist ./src/**/*.ts

# Deploy and run (uses .jsc files automatically)
bun run ./dist/index.js
```

#### 3. Optimize with Bun.build()

```typescript
// For larger applications, create optimized bundles
await Bun.build({
  entrypoints: ["./src/index.ts"],
  target: "bun",
  format: "esm",
  outdir: "./dist",
  splitting: true,     // Split into multiple chunks
  minify: true,        // Minify code
  sourcemap: "external", // Generate sourcemaps
});
```

**Tree-shaking:**
- Dead code elimination
- Smaller bundle sizes
- Faster load times

#### 4. Configure Target Appropriately

```typescript
// For server-side code
await Bun.build({
  target: "bun", // Optimized for Bun runtime
  // ...
});

// For browser code
await Bun.build({
  target: "browser", // Browser-compatible output
  // ...
});
```

#### 5. Use Plugins Judiciously

```typescript
import { plugin } from "bun";

// Plugins add flexibility but can impact performance
await Bun.build({
  entrypoints: ["./app.ts"],
  plugins: [
    {
      name: "custom-loader",
      setup(build) {
        build.onResolve({ filter: /^custom:/ }, (args) => {
          // Custom resolution logic
          return { path: "./resolved.js" };
        });
        build.onLoad({ filter: /\.custom$/ }, async (args) => {
          // Custom loading logic
          const contents = await Bun.file(args.path).text();
          return { contents, loader: "js" };
        });
      },
    },
  ],
});
```

**Best practices:**
- Keep plugin logic lightweight
- Cache results when possible
- Avoid unnecessary file I/O in hooks

#### 6. Avoid require() for Auto-Install

```typescript
// ✅ Good: Works with auto-install
import express from "express";

// ❌ Problematic: May cause pending import errors with auto-install
const express = require("express");

// ❌ Problematic: Dynamic imports with auto-install
const module = await import("package-name");
```

**Use `import` statements for best auto-install compatibility.**

### Module Registry

Bun's `Loader.registry` provides an ESM module registry:

```typescript
// Dynamic module loading and management
// Supports re-transpilation if module deleted from map
```

### Import Kinds Supported

- `import-statement`: Standard ES module imports
- `require-call`: CommonJS require() calls
- `dynamic-import`: Dynamic import() expressions
- `import-rule`: CSS @import rules
- `url-token`: CSS url() tokens

---

## 8. Node.js Compatibility

### Overview
Bun aims to be a drop-in replacement for Node.js, striving for 100% API compatibility. It natively implements many Node.js and Web APIs and runs thousands of tests from Node.js's test suite before each release. **If a package works in Node.js but not in Bun, it is considered a bug in Bun.**

### Fully Supported Node.js Modules

The following Node.js built-in modules are **fully implemented** in Bun:

- ✅ `node:assert` - Assertion testing
- ✅ `node:buffer` - Binary data handling
- ✅ `node:console` - Console logging
- ✅ `node:dgram` - UDP datagram sockets
- ✅ `node:diagnostics_channel` - Diagnostics channel
- ✅ `node:dns` - DNS resolution
- ✅ `node:events` - Event emitter
- ✅ `node:fs` - File system operations
- ✅ `node:http` - HTTP server/client
- ✅ `node:net` - TCP networking
- ✅ `node:os` - Operating system utilities
- ✅ `node:path` - Path manipulation (100% test suite passing)
- ✅ `node:punycode` - Punycode encoding (deprecated by Node.js)
- ✅ `node:querystring` - URL query string parsing
- ✅ `node:readline` - Interactive input
- ✅ `node:stream` - Stream API
- ✅ `node:string_decoder` - String decoding
- ✅ `node:timers` - Timer functions (recommend global functions)
- ✅ `node:tty` - TTY functionality
- ✅ `node:url` - URL parsing
- ✅ `node:zlib` - Compression

### Partially Supported Node.js Modules

These modules have some functionality implemented but may have missing features or differences:

#### node:async_hooks
- ✅ `AsyncLocalStorage`
- ✅ `AsyncResource`
- ❌ V8 promise hooks are not called

#### node:child_process
- ✅ Core functionality
- ❌ Missing `proc.gid`, `proc.uid`
- ❌ `Stream` class not exported
- ❌ IPC cannot send socket handles

#### node:cluster
- ✅ Core functionality
- ❌ Handles and file descriptors cannot be passed between workers
- ⚠️ Load-balancing HTTP requests limited to Linux (via `SO_REUSEPORT`)

#### node:crypto
- ✅ Most crypto operations
- ❌ Missing `secureHeapUsed`, `setEngine`, `setFips`

#### node:domain
- ✅ Basic functionality
- ❌ Missing `Domain`, `active`

#### node:http2
- ✅ Client & server implemented
- ❌ Missing `options.allowHTTP1`, `options.enableConnectProtocol`
- ❌ Missing ALTSVC extension
- ❌ Missing `http2stream.pushStream`

#### node:https
- ✅ APIs implemented
- ⚠️ `Agent` not always used

#### node:module
- ✅ Core module system
- ❌ Missing `syncBuiltinESMExports`, `Module#load()`
- ❌ `module._extensions`, `module._pathCache`, `module._cache` are no-ops
- ❌ `module.register` not implemented (use `Bun.plugin` instead)

#### node:perf_hooks
- ✅ APIs implemented
- ⚠️ Node.js test suite does not pass yet

#### node:tls
- ✅ Core TLS functionality
- ❌ Missing `tls.createSecurePair`

#### node:util
- ✅ Most utilities
- ❌ Missing `getCallSite`, `getCallSites`, `getSystemErrorMap`, `getSystemErrorMessage`
- ❌ Missing `transferableAbortSignal`, `transferableAbortController`

#### node:v8
- ✅ `writeHeapSnapshot` and `getHeapSnapshot`
- ⚠️ `serialize` and `deserialize` use JavaScriptCore's wire format (not V8's)

#### node:vm
- ✅ Core functionality and ES modules
- ❌ Missing `vm.measureMemory`
- ❌ Some `cachedData` functionality missing

#### node:wasi
- ⚠️ Partially implemented

#### node:worker_threads
- ✅ `Worker` core functionality
- ❌ `Worker` doesn't support: `stdin`, `stdout`, `stderr`, `trackedUnmanagedFds`, `resourceLimits`
- ❌ Missing `markAsUntransferable`, `moveMessagePortToContext`

#### node:inspector
- ✅ Partially implemented
- ✅ `Profiler` API supported

#### node:test
- ⚠️ Partly implemented
- ❌ Missing mocks, snapshots, timers
- 💡 Use `bun:test` instead (recommended)

### Not Supported Node.js Modules

The following modules are **not currently implemented** in Bun:

- ❌ `node:repl` - REPL functionality
- ❌ `node:sqlite` - SQLite (use `bun:sqlite` instead)
- ❌ `node:trace_events` - Trace events

### Fully Supported Node.js Globals

Bun fully implements the following Node.js and Web API globals:

- ✅ `AbortController` / `AbortSignal`
- ✅ `Blob`
- ✅ `Buffer`
- ✅ `__dirname` / `__filename`
- ✅ `atob()` / `btoa()`
- ✅ `Atomics`
- ✅ `BroadcastChannel`
- ✅ `clearImmediate()` / `setImmediate()`
- ✅ `clearInterval()` / `setInterval()`
- ✅ `clearTimeout()` / `setTimeout()`
- ✅ `console`
- ✅ `CompressionStream` / `DecompressionStream`
- ✅ `CountQueuingStrategy`
- ✅ `Crypto` / `SubtleCrypto` / `CryptoKey`
- ✅ `CustomEvent` / `Event` / `EventTarget` / `MessageEvent`
- ✅ `exports`
- ✅ `fetch()` / `FormData` / `Headers` / `Request` / `Response`
- ✅ `global` / `globalThis`
- ✅ `JSON`
- ✅ `module`
- ✅ `performance`
- ✅ `queueMicrotask()`
- ✅ `ReadableByteStreamController` / `ReadableStream` / `ReadableStreamDefaultController` / `ReadableStreamDefaultReader`
- ✅ `reportError()`
- ✅ `require()`
- ✅ `ShadowRealm`

### Polyfilled Packages

Bun embeds and injects polyfills for certain packages for compatibility:

- `assert`
- `browserify-zlib`
- `buffer`
- `constants-browserify`
- `crypto-browserify`
- `domain-browser`
- `events`
- `https-browserify`
- `os-browserify`
- `path-browserify`
- `process`
- `punycode`
- `querystring-es3`
- `stream-browserify`
- `stream-http`
- `string_decoder`
- `timers-browserify`
- `tty-browserify`
- `url`
- `util`
- `vm-browserify`

### Compatibility Status

**Current Status:**
- Bun is compatible with Node.js v23
- Actively improving compatibility
- Running thousands of Node.js tests
- Open issue tracker for incompatibilities

**Philosophy:**
- Any package working in Node.js but not in Bun is a bug
- High priority on ecosystem compatibility
- Native implementations preferred over polyfills
- Continuous testing against Node.js test suite

---

## 9. Startup Time Advantages

### Overview
Bun offers **significant startup time advantages** over Node.js, primarily due to its use of the JavaScriptCore engine, implementation in Zig, and integrated toolkit approach. Developers can further maximize these benefits through bytecode caching and compiled executables.

### Performance Benchmarks

**Basic script execution:**
```bash
# Node.js
node hello.js  # 25.1ms

# Bun
bun hello.js   # 5.2ms (4.8x faster)
```

**Package.json scripts:**
```bash
# npm run on Linux
npm run script  # ~170ms

# Bun
bun run script  # ~6ms (28x faster)
```

**Process spawning:**
```bash
# Node.js child_process
echo hi  # 1.47ms

# Bun.spawnSync
echo hi  # 888.14 µs (60% faster)
```

### Factors Contributing to Fast Startup

#### 1. JavaScriptCore Engine
- **Fast cold starts**: JavaScriptCore is optimized for startup time
- **Lower initialization overhead** compared to V8
- **Efficient memory usage**: Less memory needed during startup

#### 2. Zig Implementation
- **High-performance language**: Low-level control and optimization
- **Compiled to native code**: No JIT compilation overhead
- **Small binary size**: Efficient executable
- **Minimal runtime overhead**: Lean initialization

#### 3. Minimal Static Initializers
Bun maintains a low count of static initializers (functions that run at startup):

```typescript
// From test/js/bun/perf/static-initializers.test.ts
// Ensures startup performance doesn't regress
test("static initializers count", () => {
  expect(getStaticInitializerCount()).toBeLessThan(THRESHOLD);
});
```

**Benefits:**
- Fewer functions executed at startup
- Faster time to first instruction
- Reduced initialization overhead

#### 4. Direct TypeScript Execution
- **No separate transpilation step**: TypeScript executed directly
- **Built-in transpiler**: No external tools needed
- **Reduced I/O**: No intermediate files

#### 5. Efficient Process Spawning
- **`posix_spawn(3)`**: Fast process creation
- **60% faster** than Node.js `child_process`
- **Reduced memory overhead**: No fork() duplication

#### 6. Integrated Tooling
- **Single executable**: Runtime, bundler, package manager, test runner
- **Shared infrastructure**: Optimized interactions between components
- **No tool chaining**: Reduced startup overhead

### Maximizing Performance Benefits

#### 1. Bytecode Caching

**Enable bytecode caching for 1.5x to 4x faster startup:**

```bash
# Generate bytecode at build time
bun build ./index.ts --target=bun --bytecode --outdir=./dist
```

**How it works:**
- Parsing moved to build time
- Bytecode generated once
- Skip lazy parsing at runtime
- All functions pre-compiled

**Performance impact by application size:**
- Small apps: ~1.5x faster
- Medium apps: ~2x faster
- Large apps: ~4x faster

**Usage:**
```bash
# Bun automatically uses .jsc files
bun run ./dist/index.js  # Uses index.jsc
```

**Combining with other optimizations:**
```bash
# Bytecode + minification + sourcemaps
bun build ./index.ts \
  --target=bun \
  --bytecode \
  --minify \
  --sourcemap=external \
  --outdir=./dist
```

**Limitations:**
- Not portable across Bun versions
- Must regenerate when upgrading Bun
- Silent fallback to source if version mismatch

#### 2. Compiled Executables

**Create standalone executables for fastest startup:**

```bash
# Compile to executable
bun build --compile ./index.ts --outfile myapp

# With bytecode embedded
bun build --compile --bytecode ./index.ts --outfile myapp
```

**Benefits:**
- Parsing moved to build time
- Transpilation moved to build time
- Code optimization at build time
- Bytecode embedded (no parsing at runtime)
- Reduced memory usage
- Single binary distribution

**Performance characteristics:**
```bash
# Regular execution
bun index.ts  # Fast

# Compiled executable
./myapp       # Fastest (no parsing at all)
```

#### 3. Optimize Module Loading

**Use Bun-optimized bundles:**
```typescript
await Bun.build({
  entrypoints: ["./app.ts"],
  target: "bun",      // Optimize for Bun runtime
  format: "esm",
  outdir: "./dist",
  minify: true,
  splitting: true,    // Code splitting
});
```

**Benefits:**
- Bundles marked to bypass re-transpilation
- Smaller code size (faster parsing)
- Tree-shaking (less code to load)

#### 4. Minimize Dependencies

```bash
# Leverage auto-install for simple scripts
# No node_modules overhead
import express from "express";  # Auto-installs
```

**Benefits:**
- No `node_modules` scanning
- Global cache reuse
- Faster resolution

#### 5. Use Native Bun APIs

**Replace slow operations with fast Bun APIs:**
```typescript
// Instead of node:fs
const file = Bun.file("./data.txt");
const text = await file.text();

// Instead of child_process
const proc = Bun.spawn(["ls", "-la"]);
await proc.exited;

// Instead of better-sqlite3
import { Database } from "bun:sqlite";
const db = new Database("./db.sqlite");
```

### Startup Time Comparison Matrix

| Approach | Startup Time | Use Case |
|----------|--------------|----------|
| `node script.js` | Slowest (~25ms) | Legacy Node.js |
| `bun script.js` | Fast (~5ms) | Development |
| `bun script.js` (with Bun APIs) | Faster (~3ms) | Production |
| `bun build --compile` | Very Fast (~2ms) | CLI tools |
| `bun build --compile --bytecode` | Fastest (~1ms) | Performance-critical |

### Best Practices Summary

**For Development:**
- Use `bun run` for scripts (28x faster than `npm run`)
- Direct TypeScript execution (no build step)
- Auto-install for quick prototyping

**For Production:**
- Use `bun build --target=bun --bytecode` for server apps
- Use `bun build --compile --bytecode` for CLI tools
- Enable minification and tree-shaking
- Use Bun-native APIs where possible

**For CLI Tools:**
- Always use `--compile --bytecode`
- Startup time is critical for CLI UX
- Single binary distribution (no dependencies)

**For Large Applications:**
- Bytecode caching provides biggest gains (4x)
- Code splitting for faster initial load
- Monitor static initializer count

---

## 10. Known Migration Issues

### Overview
While Bun aims for drop-in Node.js compatibility, there are known limitations and differences that developers should be aware of when migrating. Bun considers any package working in Node.js but not in Bun to be a bug, and compatibility is actively being improved.

### Node.js Built-in Module Limitations

#### Partially Implemented Modules

**node:async_hooks**
- ✅ `AsyncLocalStorage` and `AsyncResource` work
- ❌ V8 promise hooks are not called
- **Impact**: Libraries relying on V8 promise hooks may not work correctly

**node:child_process**
- ❌ Missing `proc.gid` and `proc.uid`
- ❌ `Stream` class not exported
- ❌ IPC cannot send socket handles
- **Impact**: Process ownership management and socket passing won't work

**node:cluster**
- ❌ Handles and file descriptors cannot be passed between workers
- ⚠️ Load-balancing HTTP requests only works on Linux (via `SO_REUSEPORT`)
- **Impact**: Multi-process load balancing limited on non-Linux systems

**node:crypto**
- ❌ Missing `secureHeapUsed`, `setEngine`, `setFips`
- **Impact**: FIPS compliance and custom crypto engines not supported

**node:http2**
- ❌ Missing `options.allowHTTP1`, `options.enableConnectProtocol`
- ❌ Missing ALTSVC extension
- ❌ Missing `http2stream.pushStream`
- **Impact**: Some HTTP/2 advanced features unavailable

**node:module**
- ❌ `module.register` not implemented
- 💡 Use `Bun.plugin` instead
- ❌ `module._extensions`, `module._pathCache`, `module._cache` are no-ops
- **Impact**: Custom module loaders need rewriting for Bun.plugin

**node:v8**
- ⚠️ `serialize` and `deserialize` use JavaScriptCore's wire format (not V8's)
- **Impact**: Serialized data not compatible between Node.js and Bun

**node:vm**
- ❌ Missing `vm.measureMemory`
- ❌ Some `cachedData` functionality missing
- **Impact**: Memory measurement and code caching features limited

**node:worker_threads**
- ❌ `Worker` doesn't support: `stdin`, `stdout`, `stderr`, `trackedUnmanagedFds`, `resourceLimits`
- ❌ Missing `markAsUntransferable`, `moveMessagePortToContext`
- **Impact**: Advanced worker configuration and memory limits not available

**node:test**
- ❌ Missing mocks, snapshots, timers
- 💡 Use `bun:test` instead (recommended)
- **Impact**: Need to migrate tests to bun:test or use Jest

#### Not Implemented Modules

- ❌ `node:repl` - REPL functionality not available
- ❌ `node:trace_events` - Tracing not supported
- ❌ `node:sqlite` - Use `bun:sqlite` instead

**Impact**: Libraries depending on these modules won't work

### Package Management Issues

#### No node_modules by Default

**Issue:**
```bash
# Bun uses global cache by default
bun install  # No node_modules folder created
```

**Consequences:**
1. **No Intellisense**: IDEs rely on type declarations in `node_modules`
2. **No `patch-package` support**: Cannot patch dependencies
3. **Some tools may break**: Build tools that scan `node_modules` directly

**Workaround:**
```bash
# Force node_modules creation
bun install --backend=hardlink
```

#### Isolated Installs Issues

**Issue:**
```bash
bun install --linker=isolated
```

**Potential problems:**
- Packages with hardcoded paths may fail
- Dynamic imports not following Node.js resolution may break
- Build tools scanning `node_modules` directly may not work

#### No --preserve-symlinks Equivalent

**Issue:**
- Node.js has `--preserve-symlinks` flag
- Bun runtime doesn't expose equivalent
- **Impact**: Some monorepo setups may have resolution issues

**Workaround:**
```bash
# May need to use hardlink backend
bun install --backend=hardlink
```

### Testing Compatibility Issues

#### Jest Compatibility

**Bun's test runner is Jest-compatible but has gaps:**

**Missing features:**
- ❌ `expect().toHaveReturned()` matcher
- ❌ Some Jest configuration options not supported:
  - `transform` (irrelevant in Bun)
  - `extensionsToTreatAsEsm` (handled automatically)
  - `haste`, `watchman`, `watchPlugins`, `watchPathIgnorePatterns`
  - `verbose` (handled differently)

**jsdom Not Supported:**
```typescript
// ❌ jsdom doesn't work (uses V8 APIs internally)
import jsdom from "jsdom";

// ✅ Use happy-dom instead
import { Window } from "happy-dom";
```

**Impact**: Tests using jsdom need migration to happy-dom

#### Migration Path

```typescript
// Before (Jest + jsdom)
import { JSDOM } from "jsdom";
const dom = new JSDOM("<html></html>");

// After (bun:test + happy-dom)
import { Window } from "happy-dom";
const window = new Window();
```

### Compatibility with Native Addons

**Issue:**
- Bun may have issues with some native Node.js addons (`.node` files)
- Particularly problematic: `better-sqlite3.node`

**Workaround:**
- Use Bun-native alternatives where available
- `better-sqlite3` → `bun:sqlite`
- Check Bun's compatibility table for your specific addon

### Process and Environment Differences

#### Environment Variable Loading

**Difference:**
```bash
# Node.js: Manual dotenv
npm install dotenv
require('dotenv').config()

# Bun: Automatic
# Just works, no package needed
```

**Impact**: May load unexpected `.env` files if not careful

**File precedence:**
1. `.env.local` (highest)
2. `.env.{environment}` (e.g., `.env.production`)
3. `.env`

#### Runtime Detection

```typescript
// Detect if running in Bun
if (process.isBun) {
  // Use Bun-specific APIs
} else {
  // Fallback to Node.js APIs
}
```

### TypeScript Configuration Issues

**Bun ignores some tsconfig.json options:**
- Certain compiler options handled automatically
- May need to adjust configuration for Bun

**Best practice:**
```json
{
  "compilerOptions": {
    "types": ["bun-types"],
    "module": "esnext",
    "target": "esnext"
  }
}
```

### Breaking Changes Checklist

When migrating from Node.js to Bun, check for:

1. **Native addons usage** - May need Bun alternatives
2. **jsdom dependency** - Switch to happy-dom
3. **node:repl usage** - Not supported
4. **better-sqlite3** - Switch to bun:sqlite
5. **V8-specific APIs** - JavaScriptCore differences
6. **module.register** - Use Bun.plugin instead
7. **Jest features** - Some gaps in compatibility
8. **node_modules scanning** - May need hardlink backend
9. **Socket passing in IPC** - Not supported
10. **HTTP/2 advanced features** - Some missing

### Debugging Compatibility Issues

**Check Bun's compatibility status:**
```bash
# Visit Bun's compatibility documentation
# https://bun.sh/docs/runtime/nodejs-compat
```

**Report bugs:**
- If something works in Node.js but not Bun, it's a bug
- Report on Bun's GitHub issue tracker
- Include minimal reproduction case

**Test compatibility:**
```typescript
// Conditional code for compatibility
if (process.isBun) {
  // Bun-specific implementation
  import { Database } from "bun:sqlite";
} else {
  // Node.js fallback
  import Database from "better-sqlite3";
}
```

### Common Gotchas

1. **Auto-install surprises**: Packages may auto-install unexpectedly
2. **Global cache location**: Packages cached globally, not per-project
3. **Bytecode version mismatch**: Silent fallback when Bun version changes
4. **No npm lifecycle scripts**: Some package postinstall scripts may not run
5. **Different module resolution**: Subtle differences in edge cases

### Migration Strategy

**Recommended approach:**

1. **Start with isolated script testing**
   ```bash
   # Test individual scripts first
   bun run script.ts
   ```

2. **Gradually migrate dependencies**
   ```bash
   # Start with pure JavaScript packages
   # Add native modules later
   ```

3. **Use compatibility layers**
   ```typescript
   // Abstract platform-specific code
   import { getDB } from "./db-adapter";
   ```

4. **Run Node.js and Bun in parallel**
   ```json
   {
     "scripts": {
       "start:node": "node index.js",
       "start:bun": "bun index.js",
       "test:node": "jest",
       "test:bun": "bun test"
     }
   }
   ```

5. **Monitor Bun's changelog**
   - Compatibility constantly improving
   - New features added regularly

---

## Summary

Bun provides compelling alternatives to Node.js APIs with significant performance advantages:

**Biggest Wins:**
- 🚀 **4.8x faster startup** (5.2ms vs 25.1ms)
- 🗄️ **3-6x faster SQLite** operations with `bun:sqlite`
- ⚡ **60% faster process spawning** with `Bun.spawn()`
- 📁 **2x faster file I/O** with `Bun.file()` / `Bun.write()`
- 🎯 **1.5-4x faster with bytecode** caching

**Best Migration Candidates:**
- CLI tools (startup time critical)
- SQLite-heavy applications
- File I/O intensive scripts
- Process-spawning applications
- TypeScript codebases

**Watch Out For:**
- Native addon compatibility
- jsdom usage (use happy-dom)
- Advanced HTTP/2 features
- Some Jest features
- V8-specific serialization

**References:**
- [Bun Repository](https://github.com/oven-sh/bun)
- [DeepWiki Bun Overview](https://deepwiki.com/wiki/oven-sh/bun#1)
- All findings sourced from oven-sh/bun repository via DeepWiki

---

*Last Updated: 2024*
*Research Method: DeepWiki queries on oven-sh/bun repository*
