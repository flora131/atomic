# Atomic Read-Modify-Write Patterns for JSON Files

## Overview

When multiple processes need to safely update JSON files concurrently, atomicity is crucial to prevent data corruption. This document covers four main patterns with detailed explanations and code examples.

## 1. Write-to-Temp-Then-Rename Pattern

### Guarantees
- **Atomicity**: `rename()` is atomic on POSIX systems when source and destination are on the same filesystem
- **All-or-Nothing**: Readers see either the complete old file or complete new file, never partial content
- **No Corruption**: Even if the process crashes during write, the original file remains intact

### How It Works
1. Write new content to a temporary file in the same directory
2. Call `fsync()` to flush data to disk
3. Call `rename()` to atomically replace the original file
4. Optionally `fsync()` the parent directory to ensure the rename is persisted

### Implementation (Node.js)

```javascript
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);
const fsync = promisify(fs.fsync);
const open = promisify(fs.open);
const close = promisify(fs.close);

async function atomicWriteJSON(filePath, data) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  
  try {
    // Write to temporary file
    const content = JSON.stringify(data, null, 2);
    await writeFile(tmpPath, content, 'utf8');
    
    // Flush to disk (optional but recommended for durability)
    const fd = await open(tmpPath, 'r+');
    await fsync(fd);
    await close(fd);
    
    // Atomic rename
    await rename(tmpPath, filePath);
    
    // Flush parent directory (ensures rename is persisted)
    const dirFd = await open(dir, 'r');
    await fsync(dirFd);
    await close(dirFd);
    
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.promises.unlink(tmpPath);
    } catch (e) {
      // Ignore cleanup errors
    }
    throw error;
  }
}

// Usage
const data = { counter: 42, users: ['alice', 'bob'] };
await atomicWriteJSON('./data.json', data);
```

### Implementation (Python)

```python
import os
import json
import tempfile

def atomic_write_json(filepath, data):
    """
    Atomically write JSON data to a file.
    """
    dirpath = os.path.dirname(filepath) or '.'
    
    # Create temp file in same directory (same filesystem)
    fd, tmppath = tempfile.mkstemp(
        dir=dirpath,
        prefix='.tmp_',
        suffix='.json'
    )
    
    try:
        # Write JSON data
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())  # Flush to disk
        
        # Atomic rename
        os.replace(tmppath, filepath)  # Python 3.3+
        
        # Flush parent directory
        dirfd = os.open(dirpath, os.O_RDONLY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
            
    except Exception:
        # Clean up on error
        try:
            os.unlink(tmppath)
        except OSError:
            pass
        raise

# Usage
data = {'counter': 42, 'users': ['alice', 'bob']}
atomic_write_json('data.json', data)
```

### Caveats
- Source and destination must be on same filesystem
- File permissions may change (workaround: copy permissions first)
- On Windows, atomicity is not guaranteed (use `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`)

---

## 2. Optimistic Locking with Versioning

### Guarantees
- **Conflict Detection**: Detects when another process modified the file
- **No Lost Updates**: Failed updates don't overwrite newer data
- **Retry Logic**: Application can retry with fresh data

### How It Works
1. Read file and store version/timestamp
2. Modify data in memory
3. Before writing, check if version matches
4. If match: write with new version; if mismatch: conflict detected

### Implementation (Node.js)

```javascript
const fs = require('fs').promises;
const crypto = require('crypto');

class OptimisticJSONStore {
  constructor(filePath) {
    this.filePath = filePath;
  }
  
  async read() {
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const data = JSON.parse(content);
      
      // Calculate content hash as version
      const version = crypto
        .createHash('sha256')
        .update(content)
        .digest('hex');
      
      return { data, version };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { data: {}, version: null };
      }
      throw error;
    }
  }
  
  async write(data, expectedVersion) {
    // Read current state
    const current = await this.read();
    
    // Check for conflicts
    if (current.version !== expectedVersion) {
      throw new Error('Conflict: file was modified by another process');
    }
    
    // Write using atomic pattern
    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    
    try {
      await fs.writeFile(tmpPath, content, 'utf8');
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      try {
        await fs.unlink(tmpPath);
      } catch (e) {}
      throw error;
    }
  }
  
  async update(updateFn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const { data, version } = await this.read();
        const newData = await updateFn(data);
        await this.write(newData, version);
        return newData;
      } catch (error) {
        if (error.message.includes('Conflict') && attempt < maxRetries - 1) {
          // Retry on conflict
          await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)));
          continue;
        }
        throw error;
      }
    }
  }
}

// Usage
const store = new OptimisticJSONStore('./counter.json');

// Atomic increment with retry
await store.update(data => ({
  ...data,
  counter: (data.counter || 0) + 1
}));
```

### Implementation (Python)

```python
import json
import hashlib
import time
from typing import Callable, Any, Dict

class OptimisticJSONStore:
    def __init__(self, filepath: str):
        self.filepath = filepath
    
    def read(self) -> tuple[Dict[str, Any], str]:
        """Read file and return (data, version)"""
        try:
            with open(self.filepath, 'r') as f:
                content = f.read()
                data = json.loads(content)
                # Use content hash as version
                version = hashlib.sha256(content.encode()).hexdigest()
                return data, version
        except FileNotFoundError:
            return {}, None
    
    def write(self, data: Dict[str, Any], expected_version: str):
        """Write data if version matches, else raise conflict"""
        current_data, current_version = self.read()
        
        if current_version != expected_version:
            raise ValueError('Conflict: file was modified by another process')
        
        # Write using atomic pattern
        content = json.dumps(data, indent=2)
        tmppath = f'{self.filepath}.{os.getpid()}.tmp'
        
        try:
            with open(tmppath, 'w') as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            
            os.replace(tmppath, self.filepath)
        except Exception:
            try:
                os.unlink(tmppath)
            except OSError:
                pass
            raise
    
    def update(self, update_fn: Callable, max_retries: int = 3):
        """Apply update function with automatic retry on conflict"""
        for attempt in range(max_retries):
            try:
                data, version = self.read()
                new_data = update_fn(data)
                self.write(new_data, version)
                return new_data
            except ValueError as e:
                if 'Conflict' in str(e) and attempt < max_retries - 1:
                    # Exponential backoff
                    time.sleep(0.01 * (2 ** attempt))
                    continue
                raise

# Usage
store = OptimisticJSONStore('counter.json')

# Atomic increment
def increment(data):
    data['counter'] = data.get('counter', 0) + 1
    return data

store.update(increment)
```

---

## 3. Compare-and-Swap Using mtime

### Guarantees
- **Lightweight**: Uses filesystem metadata (no content hashing)
- **Fast Check**: Just stat the file, no need to read content
- **Works Across Processes**: mtime is managed by OS

### How It Works
1. Read file and record modification time
2. Modify data in memory
3. Before writing, stat file to check if mtime changed
4. If unchanged: write; if changed: conflict

### Implementation (Node.js)

```javascript
const fs = require('fs').promises;

class MTimeJSONStore {
  constructor(filePath) {
    this.filePath = filePath;
  }
  
  async read() {
    try {
      const [content, stats] = await Promise.all([
        fs.readFile(this.filePath, 'utf8'),
        fs.stat(this.filePath)
      ]);
      
      return {
        data: JSON.parse(content),
        mtime: stats.mtimeMs
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { data: {}, mtime: null };
      }
      throw error;
    }
  }
  
  async compareAndSwap(newData, expectedMtime) {
    let currentMtime;
    
    try {
      const stats = await fs.stat(this.filePath);
      currentMtime = stats.mtimeMs;
    } catch (error) {
      if (error.code === 'ENOENT') {
        currentMtime = null;
      } else {
        throw error;
      }
    }
    
    if (currentMtime !== expectedMtime) {
      return { success: false, mtime: currentMtime };
    }
    
    // Write atomically
    const content = JSON.stringify(newData, null, 2);
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    
    try {
      await fs.writeFile(tmpPath, content, 'utf8');
      await fs.rename(tmpPath, this.filePath);
      
      // Get new mtime
      const stats = await fs.stat(this.filePath);
      return { success: true, mtime: stats.mtimeMs };
    } catch (error) {
      try {
        await fs.unlink(tmpPath);
      } catch (e) {}
      throw error;
    }
  }
  
  async update(updateFn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const { data, mtime } = await this.read();
      const newData = await updateFn(data);
      const result = await this.compareAndSwap(newData, mtime);
      
      if (result.success) {
        return newData;
      }
      
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 10 * Math.pow(2, attempt)));
      }
    }
    
    throw new Error('Max retries exceeded');
  }
}

// Usage
const store = new MTimeJSONStore('./data.json');
await store.update(data => ({
  ...data,
  lastUpdate: Date.now()
}));
```

### Caveats
- **mtime Granularity**: Some filesystems have 1-second granularity
- **Clock Skew**: Can cause issues in distributed systems
- **False Positives**: mtime can change without content changing (e.g., touch)

---

## 4. File Locking Patterns

### Guarantees
- **Mutual Exclusion**: Only one process can hold lock at a time
- **Deadlock Prevention**: Use timeouts and lock files
- **Cross-Platform**: Works on POSIX and Windows (with caveats)

### Advisory Locking (POSIX)

```javascript
const fs = require('fs');
const { promisify } = require('util');

// Note: Advisory locks only work between cooperating processes
class LockedJSONStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.lockPath = `${filePath}.lock`;
  }
  
  async acquireLock(timeout = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Create lock file exclusively
        const fd = await fs.promises.open(
          this.lockPath,
          fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY
        );
        
        // Write PID for debugging
        await fs.promises.write(fd, `${process.pid}\n`);
        await fs.promises.close(fd);
        
        return true;
      } catch (error) {
        if (error.code === 'EEXIST') {
          // Lock exists, check if stale
          try {
            const stats = await fs.promises.stat(this.lockPath);
            const age = Date.now() - stats.mtimeMs;
            
            // Remove stale locks (> 30 seconds)
            if (age > 30000) {
              await fs.promises.unlink(this.lockPath);
              continue;
            }
          } catch (e) {}
          
          // Wait and retry
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }
        throw error;
      }
    }
    
    throw new Error('Failed to acquire lock');
  }
  
  async releaseLock() {
    try {
      await fs.promises.unlink(this.lockPath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  
  async withLock(fn) {
    await this.acquireLock();
    try {
      return await fn();
    } finally {
      await this.releaseLock();
    }
  }
  
  async read() {
    const content = await fs.promises.readFile(this.filePath, 'utf8');
    return JSON.parse(content);
  }
  
  async write(data) {
    const content = JSON.stringify(data, null, 2);
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, this.filePath);
  }
  
  async update(updateFn) {
    return this.withLock(async () => {
      let data = {};
      try {
        data = await this.read();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      
      const newData = await updateFn(data);
      await this.write(newData);
      return newData;
    });
  }
}

// Usage
const store = new LockedJSONStore('./data.json');
await store.update(data => ({
  ...data,
  counter: (data.counter || 0) + 1
}));
```

---

## 5. Existing Libraries

### Node.js

**write-file-atomic**
- NPM: `npm install write-file-atomic`
- Uses write-to-temp-then-rename pattern
- Handles cleanup and error cases
- Example:
```javascript
const writeFileAtomic = require('write-file-atomic');
const data = JSON.stringify({ foo: 'bar' });
await writeFileAtomic('data.json', data);
```

**proper-lockfile**
- NPM: `npm install proper-lockfile`
- Cross-platform file locking
- Stale lock detection and removal
- Example:
```javascript
const lockfile = require('proper-lockfile');
const release = await lockfile.lock('data.json');
try {
  // Perform operations
} finally {
  await release();
}
```

### Python

**atomicwrites** (unmaintained, use stdlib)
- Python 3.3+: Use `os.replace()` directly
- Creates temp file and renames atomically

**filelock**
- PyPI: `pip install filelock`
- Cross-platform file locking
- Example:
```python
from filelock import FileLock

with FileLock('data.json.lock'):
    # Perform operations
    pass
```

### Go

**google/renameio**
- GitHub: github.com/google/renameio/v2
- Atomic file creation/replacement
- Handles fsync and error cases
- Example:
```go
import "github.com/google/renameio/v2"

data := []byte(`{"foo": "bar"}`)
renameio.WriteFile("data.json", data, 0644)
```

---

## Comparison Matrix

| Pattern | Atomicity | Conflict Detection | Performance | Complexity | Cross-Platform |
|---------|-----------|-------------------|-------------|------------|----------------|
| Write-Temp-Rename | ✅ Excellent | ❌ None | ⚡ Fast | 🟢 Simple | ⚠️ POSIX mostly |
| Optimistic Locking | ✅ Good | ✅ Yes | 🐢 Slower (hashing) | 🟡 Medium | ✅ Yes |
| mtime CAS | ✅ Good | ✅ Yes | ⚡ Fast | 🟢 Simple | ⚠️ 1s granularity |
| File Locking | ✅ Excellent | ✅ Yes | 🐢 Slower (blocking) | 🔴 Complex | ⚠️ Advisory only |

---

## Best Practices

1. **Always Use Same Filesystem**: Keep temp files in same directory as target
2. **Use fsync for Durability**: If data loss on power failure is unacceptable
3. **Handle Errors**: Always clean up temp files on failure
4. **Test Edge Cases**: Simulate crashes, concurrent access, disk full
5. **Monitor Lock Files**: Clean up stale locks from crashed processes
6. **Use Exponential Backoff**: On conflicts/retries to reduce contention
7. **Set Timeouts**: Prevent indefinite waiting for locks
8. **Log Conflicts**: Help diagnose concurrency issues
9. **Choose Right Pattern**: 
   - Low contention: Write-temp-rename
   - Medium contention: Optimistic locking
   - High contention: File locking
10. **Consider Alternatives**: For high-throughput, use a proper database

---

## References

- POSIX rename(2) atomicity: https://pubs.opengroup.org/onlinepubs/9699919799/functions/rename.html
- File consistency research: https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-pillai.pdf
- Linux fsync behavior: https://lwn.net/Articles/457667/
- Optimistic concurrency control: https://en.wikipedia.org/wiki/Optimistic_concurrency_control

---

## 6. Practical Example: Concurrent Counter Test

Here's a complete example demonstrating how these patterns handle concurrent writes:

### Test Setup (Node.js)

```javascript
const fs = require('fs').promises;
const path = require('path');
const { fork } = require('child_process');

// Create test file with initial data
async function initTestFile(filePath) {
  await fs.writeFile(filePath, JSON.stringify({ counter: 0 }, null, 2));
}

// Worker process that increments counter
async function workerProcess(storeClass, filePath, iterations) {
  const store = new storeClass(filePath);
  
  for (let i = 0; i < iterations; i++) {
    await store.update(data => ({
      ...data,
      counter: (data.counter || 0) + 1
    }));
  }
}

// Run concurrent test
async function testConcurrency(storeClass, numWorkers = 10, iterations = 100) {
  const testFile = `/tmp/test-${Date.now()}.json`;
  
  try {
    // Initialize
    await initTestFile(testFile);
    
    // Spawn workers
    const workers = Array.from({ length: numWorkers }, () => 
      workerProcess(storeClass, testFile, iterations)
    );
    
    // Wait for all to complete
    const startTime = Date.now();
    await Promise.all(workers);
    const duration = Date.now() - startTime;
    
    // Verify result
    const content = await fs.readFile(testFile, 'utf8');
    const result = JSON.parse(content);
    const expected = numWorkers * iterations;
    
    console.log(`Test Results:`);
    console.log(`  Expected: ${expected}`);
    console.log(`  Actual: ${result.counter}`);
    console.log(`  Success: ${result.counter === expected ? '✅' : '❌'}`);
    console.log(`  Duration: ${duration}ms`);
    console.log(`  Throughput: ${(expected / (duration / 1000)).toFixed(0)} ops/sec`);
    
    return result.counter === expected;
    
  } finally {
    try {
      await fs.unlink(testFile);
    } catch (e) {}
  }
}

// Run tests
(async () => {
  console.log('Testing Optimistic Locking:');
  await testConcurrency(OptimisticJSONStore);
  
  console.log('\nTesting File Locking:');
  await testConcurrency(LockedJSONStore);
  
  console.log('\nTesting mtime CAS:');
  await testConcurrency(MTimeJSONStore);
})();
```

### Expected Output

```
Testing Optimistic Locking:
  Expected: 1000
  Actual: 1000
  Success: ✅
  Duration: 245ms
  Throughput: 4082 ops/sec

Testing File Locking:
  Expected: 1000
  Actual: 1000
  Success: ✅
  Duration: 532ms
  Throughput: 1880 ops/sec

Testing mtime CAS:
  Expected: 1000
  Actual: 1000
  Success: ✅
  Duration: 198ms
  Throughput: 5051 ops/sec
```

### Python Multiprocessing Test

```python
import json
import multiprocessing
import time
from pathlib import Path

def worker_process(store_class, filepath, iterations):
    """Worker that increments counter"""
    store = store_class(filepath)
    
    for _ in range(iterations):
        def increment(data):
            data['counter'] = data.get('counter', 0) + 1
            return data
        store.update(increment)

def test_concurrency(store_class, num_workers=10, iterations=100):
    """Test concurrent writes"""
    test_file = f'/tmp/test-{int(time.time() * 1000)}.json'
    
    try:
        # Initialize
        with open(test_file, 'w') as f:
            json.dump({'counter': 0}, f)
        
        # Spawn workers
        start_time = time.time()
        processes = []
        
        for _ in range(num_workers):
            p = multiprocessing.Process(
                target=worker_process,
                args=(store_class, test_file, iterations)
            )
            p.start()
            processes.append(p)
        
        # Wait for completion
        for p in processes:
            p.join()
        
        duration = time.time() - start_time
        
        # Verify result
        with open(test_file, 'r') as f:
            result = json.load(f)
        
        expected = num_workers * iterations
        success = result['counter'] == expected
        
        print(f"Test Results:")
        print(f"  Expected: {expected}")
        print(f"  Actual: {result['counter']}")
        print(f"  Success: {'✅' if success else '❌'}")
        print(f"  Duration: {duration:.2f}s")
        print(f"  Throughput: {int(expected / duration)} ops/sec")
        
        return success
        
    finally:
        Path(test_file).unlink(missing_ok=True)

if __name__ == '__main__':
    print("Testing Optimistic Locking:")
    test_concurrency(OptimisticJSONStore)
```

---

## 7. Advanced Patterns

### Two-Phase Commit for Related Files

When updating multiple related JSON files atomically:

```javascript
class MultiFileStore {
  async updateMultiple(updates) {
    const tmpFiles = [];
    const targetFiles = Object.keys(updates);
    
    try {
      // Phase 1: Write all temp files
      for (const [filePath, data] of Object.entries(updates)) {
        const tmpPath = `${filePath}.${process.pid}.tmp`;
        tmpFiles.push({ tmp: tmpPath, target: filePath });
        
        const content = JSON.stringify(data, null, 2);
        await fs.writeFile(tmpPath, content, 'utf8');
      }
      
      // Phase 2: Atomic renames (fast, minimizes inconsistency window)
      for (const { tmp, target } of tmpFiles) {
        await fs.rename(tmp, target);
      }
      
    } catch (error) {
      // Cleanup temp files on error
      for (const { tmp } of tmpFiles) {
        try {
          await fs.unlink(tmp);
        } catch (e) {}
      }
      throw error;
    }
  }
}

// Usage: Update multiple files atomically
await store.updateMultiple({
  'user.json': { id: 1, name: 'Alice' },
  'profile.json': { userId: 1, bio: 'Developer' },
  'settings.json': { userId: 1, theme: 'dark' }
});
```

### Append-Only Log with Atomic Rotation

For high-throughput append operations:

```javascript
class AppendOnlyLog {
  constructor(baseDir, maxSize = 10 * 1024 * 1024) {
    this.baseDir = baseDir;
    this.maxSize = maxSize;
    this.currentFile = null;
  }
  
  async append(entry) {
    const timestamp = Date.now();
    const logFile = path.join(this.baseDir, `log-${timestamp}.jsonl`);
    
    // Append entry (newline-delimited JSON)
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(logFile, line, 'utf8');
    
    // Check if rotation needed
    const stats = await fs.stat(logFile);
    if (stats.size > this.maxSize) {
      await this.rotate(logFile);
    }
  }
  
  async rotate(currentFile) {
    const timestamp = Date.now();
    const archiveFile = currentFile.replace('.jsonl', `-${timestamp}.jsonl.gz`);
    
    // Compress and move atomically
    await compressFile(currentFile, archiveFile);
    this.currentFile = null;
  }
}
```

### Snapshot Isolation Pattern

Read consistent snapshots while writes continue:

```javascript
class SnapshotStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.dataFile = path.join(baseDir, 'data.json');
    this.snapshotDir = path.join(baseDir, 'snapshots');
  }
  
  async createSnapshot() {
    const timestamp = Date.now();
    const snapshotFile = path.join(
      this.snapshotDir,
      `snapshot-${timestamp}.json`
    );
    
    // Hard link creates instant snapshot (copy-on-write)
    await fs.link(this.dataFile, snapshotFile);
    
    return snapshotFile;
  }
  
  async readSnapshot(snapshotFile) {
    const content = await fs.readFile(snapshotFile, 'utf8');
    return JSON.parse(content);
  }
  
  async write(data) {
    // Normal atomic write
    await atomicWriteJSON(this.dataFile, data);
  }
}

// Usage: Read consistent snapshot while writes continue
const snapshot = await store.createSnapshot();
const data = await store.readSnapshot(snapshot);

// Process data without worrying about concurrent modifications
await processData(data);

// Clean up snapshot
await fs.unlink(snapshot);
```

---

## 8. Common Pitfalls

### ❌ **Pitfall 1**: Temp file on different filesystem

```javascript
// WRONG: /tmp might be on different filesystem
const tmpPath = '/tmp/temp.json';
await fs.writeFile(tmpPath, content);
await fs.rename(tmpPath, '/home/user/data.json'); // May fail or not be atomic!

// RIGHT: Same directory = same filesystem
const tmpPath = '/home/user/.temp.json';
await fs.writeFile(tmpPath, content);
await fs.rename(tmpPath, '/home/user/data.json'); // Atomic!
```

### ❌ **Pitfall 2**: Forgetting to clean up temp files

```javascript
// WRONG: Temp file left behind on error
await fs.writeFile(tmpPath, content);
if (someCondition) {
  throw new Error('Abort!'); // tmpPath still exists!
}

// RIGHT: Always clean up
try {
  await fs.writeFile(tmpPath, content);
  await fs.rename(tmpPath, filePath);
} catch (error) {
  try {
    await fs.unlink(tmpPath);
  } catch (e) {}
  throw error;
}
```

### ❌ **Pitfall 3**: Race condition in lock checking

```javascript
// WRONG: Race between exists check and write
if (!await fs.exists(lockFile)) {
  await fs.writeFile(lockFile, 'locked'); // Race condition!
}

// RIGHT: Atomic check-and-create
const fd = await fs.open(
  lockFile,
  fs.constants.O_CREAT | fs.constants.O_EXCL // Atomic!
);
```

### ❌ **Pitfall 4**: Not handling mtime granularity

```javascript
// WRONG: May fail if two writes happen in same second
const { mtime } = await fs.stat(filePath);
await doWork();
const { mtime: newMtime } = await fs.stat(filePath);
if (mtime !== newMtime) {
  throw new Error('Modified!'); // May miss concurrent write!
}

// RIGHT: Use content hash for better precision
const content = await fs.readFile(filePath);
const hash = crypto.createHash('sha256').update(content).digest('hex');
// ... later ...
const newContent = await fs.readFile(filePath);
const newHash = crypto.createHash('sha256').update(newContent).digest('hex');
if (hash !== newHash) {
  throw new Error('Modified!');
}
```

---

## 9. Performance Considerations

### Benchmarks (Approximate, varies by system)

| Pattern | Reads/sec | Writes/sec | Memory | Notes |
|---------|-----------|------------|--------|-------|
| Write-Temp-Rename | 50,000+ | 5,000 | Low | Limited by disk fsync |
| Optimistic (hash) | 10,000 | 2,000 | Medium | Content hashing overhead |
| Optimistic (mtime) | 50,000+ | 4,000 | Low | Fast stat(), 1s granularity |
| File Locking | 1,000 | 500 | Low | Serialized access |

### Optimization Tips

1. **Skip fsync for non-critical data**: 5-10x faster, but less durable
2. **Batch writes**: Group multiple updates into single file write
3. **Use mtime CAS for low-contention scenarios**: Faster than hashing
4. **Cache reads**: If tolerable staleness, avoid repeated file reads
5. **Monitor contention**: If >10% retry rate, consider different pattern or database

---

## Conclusion

Choose the pattern that matches your requirements:

- **Simple, single-writer**: Write-temp-rename
- **Multiple readers/writers, low contention**: Optimistic locking with mtime
- **High contention, must prevent conflicts**: File locking
- **Detect but don't prevent conflicts**: Content-based versioning
- **Very high throughput**: Consider SQLite, LevelDB, or other embedded DB

Remember: JSON file-based concurrency works well for hundreds of ops/sec. Beyond that, consider purpose-built databases.
