# Debugging Report: File Writer Flushing Issue

**Date**: February 26, 2026  
**Component**: `src/events/debug-subscriber.ts`  
**Status**: ✅ RESOLVED

---

## Issue Summary

Tests in `src/events/debug-subscriber.test.ts` were failing with JSON parsing errors:
- "SyntaxError: JSON Parse error: Unterminated string"
- "SyntaxError: JSON Parse error: Unable to parse JSON string"

Two tests were affected:
1. `initEventLog() creates a JSONL file and writes events`
2. `JSONL entries have correct format`

---

## Root Cause Analysis

### Primary Issue: Concurrent File Writes

**Problem**: Multiple tests writing to the same shared file caused data corruption.

**Evidence**:
```bash
$ cat ~/.local/share/atomic/log/events/dev.events.jsonl
{"ts":"2026-02-26T16:37:23.585Z","type":"stream.usage",...}
6:37:23.568Z","type":"stream.tool.start",...}  # ❌ Truncated/corrupted line
{"ts":"2026-02-26T16:37:23.568Z","type":"stream.text.delta",...}
```

**Root Cause**: Tests using `dev: true` option all wrote to the same `dev.events.jsonl` file in the global log directory (`~/.local/share/atomic/log/events/`). When Bun's test runner executed tests in parallel, multiple writers corrupted each other's data by:
- Interleaving writes from different tests
- Truncating partial JSON objects
- Creating invalid JSONL format

### Secondary Issue: Asynchronous Writer Operations

**Problem**: The `close()` function called `writer.end()` without awaiting the result.

**Evidence from Bun Documentation** (via DeepWiki):
> The `writer.end()` method can be synchronous or asynchronous. It returns a `number` if the operation completes synchronously, or a `Promise<number>` if it's asynchronous. To ensure all data is written before proceeding, you should `await` the result if it returns a Promise.

**Code Issue**:
```typescript
// ❌ Before: Synchronous close() that doesn't await
const close = (): void => {
  writer.end();  // May return Promise, but not awaited
};
```

While this didn't manifest as the primary issue (tests showed synchronous behavior in isolation), it's a potential race condition that could surface under different load conditions or buffer sizes.

---

## Reproduction Steps

1. Run tests: `bun test src/events/debug-subscriber.test.ts`
2. Multiple tests execute in parallel (Bun default behavior)
3. All tests using `dev: true` write to same file: `~/.local/share/atomic/log/events/dev.events.jsonl`
4. Concurrent writes corrupt the file
5. Tests reading the file encounter malformed JSON
6. JSON.parse() throws parsing errors

---

## Solution Implemented

### 1. Made `close()` Async and Properly Handle Writer Termination

**File**: `src/events/debug-subscriber.ts`

```typescript
// ✅ After: Async close() that properly awaits
const close = async (): Promise<void> => {
  const result = writer.end();
  // Bun's writer.end() can return either number (sync) or Promise<number> (async)
  // We must await if it's a Promise to ensure all data is flushed
  if (result instanceof Promise) {
    await result;
  }
};
```

**Updated Function Signatures**:
```typescript
// Before:
export async function initEventLog(options?: { dev?: boolean }): Promise<{
  write: (event: BusEvent) => void;
  close: () => void;  // ❌ Synchronous
  logPath: string;
}>

// After:
export async function initEventLog(options?: {
  dev?: boolean;
  logDir?: string;  // ✅ Added for test isolation
}): Promise<{
  write: (event: BusEvent) => void;
  close: () => Promise<void>;  // ✅ Async
  logPath: string;
}>
```

### 2. Added Test Isolation with Custom Log Directories

**File**: `src/events/debug-subscriber.test.ts`

```typescript
// ❌ Before: All tests share same file
const { write, close, logPath } = await initEventLog({ dev: true });

// ✅ After: Each test gets unique directory
const { write, close, logPath } = await initEventLog({
  dev: true,
  logDir: testDir,  // Unique per test via beforeEach()
});
```

**Test Setup**:
```typescript
beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "atomic-debug-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

### 3. Updated All Test Cases to Await `close()`

**File**: `src/events/debug-subscriber.test.ts`

```typescript
// ❌ Before: Synchronous close
write(event);
close();  // Doesn't wait for flush
const entries = await readEventLog(logPath);  // May read incomplete data

// ✅ After: Async close
write(event);
await close();  // Ensures data is flushed
const entries = await readEventLog(logPath);  // Reads complete data
```

### 4. Updated `attachDebugSubscriber()` to Match New Signature

**File**: `src/events/debug-subscriber.ts`

```typescript
// Updated to return async unsubscribe
export async function attachDebugSubscriber(bus: AtomicEventBus): Promise<{
  unsubscribe: () => Promise<void>;  // ✅ Now async
  logPath: string | null;
}>

const unsubscribe = async (): Promise<void> => {
  unsubBus();
  await close();  // ✅ Properly awaits file flush
};
```

---

## Testing & Verification

### Test Results

**Before Fix**:
```
✗ initEventLog() creates a JSONL file and writes events
  SyntaxError: JSON Parse error: Unterminated string
✗ JSONL entries have correct format  
  SyntaxError: JSON Parse error: Unable to parse JSON string
4 pass, 2 fail
```

**After Fix**:
```
✓ initEventLog() creates a JSONL file and writes events
✓ JSONL entries have correct format
✓ readEventLog() returns empty array for non-existent file
✓ readEventLog() supports filter function
✓ cleanup() retains only MAX_LOG_FILES most recent files
✓ listEventLogs() returns files most recent first
6 pass, 0 fail
```

### Stability Testing

Ran tests 5 times consecutively - all passed consistently:
```bash
for i in {1..5}; do 
  bun test src/events/debug-subscriber.test.ts
done
# Results: 30/30 tests passed (6 tests × 5 runs)
```

### Related Tests

Verified no regressions in related event system tests:
```
✓ batch-dispatcher.test.ts: 18/18 pass
✓ bus-events.test.ts: 10/10 pass
✓ coalescing.test.ts: 24/24 pass
✓ event-bus.test.ts: 27/27 pass
✓ hooks.test.ts: 10/10 pass
✓ debug-subscriber.test.ts: 6/6 pass
---
Total: 95/95 pass
```

---

## Impact Analysis

### Files Modified

1. **`src/events/debug-subscriber.ts`**
   - Made `close()` async
   - Added `logDir` parameter to `initEventLog()`
   - Updated `attachDebugSubscriber()` to return async `unsubscribe()`
   
2. **`src/events/debug-subscriber.test.ts`**
   - Added `logDir: testDir` to all `initEventLog()` calls
   - Changed all `close()` to `await close()`
   - Removed workaround `setTimeout()` delay

### Breaking Changes

**API Changes**:
- `initEventLog().close()`: Now returns `Promise<void>` instead of `void`
- `attachDebugSubscriber().unsubscribe()`: Now returns `Promise<void>` instead of `void`

**Impact**: Low - These functions are only used internally by the event system and tests. No external APIs are affected.

### Performance Impact

- **Positive**: Removed unnecessary 50ms `setTimeout()` delay from one test
- **Neutral**: Properly awaiting `writer.end()` adds negligible overhead (0-5ms)
- **Positive**: Test isolation prevents file corruption, improving test reliability

---

## Prevention Recommendations

### 1. Test Isolation Best Practices

**Always use unique temporary directories for file-based tests**:
```typescript
let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "test-prefix-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});
```

### 2. Handle Bun File Writer API Correctly

**Pattern for safely closing Bun file writers**:
```typescript
const close = async (): Promise<void> => {
  const result = writer.end();
  if (result instanceof Promise) {
    await result;
  }
};
```

### 3. Avoid Shared State in Parallel Tests

**Anti-pattern**: Using `dev: true` or other flags that create shared resources
```typescript
// ❌ Bad: Multiple tests write to same file
initEventLog({ dev: true })  // Always uses "dev.events.jsonl"
```

**Better approach**: Inject dependency for test isolation
```typescript
// ✅ Good: Each test gets unique file
initEventLog({ dev: true, logDir: uniqueTestDir })
```

### 4. Code Review Checklist

When reviewing file I/O code:
- [ ] Are write operations properly flushed/awaited?
- [ ] Are tests isolated with unique temp directories?
- [ ] Are async operations properly awaited?
- [ ] Can tests run in parallel without conflicts?
- [ ] Are cleanup operations in `afterEach()` comprehensive?

---

## Related Issues

- **Bun Documentation**: Writer API can return sync or async results
- **Test Runner Behavior**: Bun runs tests in parallel by default
- **File System Race Conditions**: Multiple processes writing to same file

---

## References

1. [Bun File System API - FileSink](https://bun.sh/docs/api/file-io#writing-files-bun-file)
2. [DeepWiki: Bun Writer Flush Behavior](https://deepwiki.com/oven-sh/bun)
3. Bun Source: `src/bun.js/webcore/FileSink.zig` - `endFromJS` implementation
4. Bun Tests: `test/js/bun/util/filesink.test.ts`

---

## Sign-off

**Issue**: File writer not properly flushing data before tests read files  
**Root Cause**: Concurrent writes to shared file + missing await on async `writer.end()`  
**Solution**: Added test isolation + made `close()` async with proper await  
**Verification**: All 6 tests pass consistently (5 runs × 6 tests = 30/30 ✓)  
**Status**: ✅ **RESOLVED**
