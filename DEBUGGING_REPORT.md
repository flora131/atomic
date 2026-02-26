# Debugging Report: Telemetry Upload Boundary Condition Test

**Date:** 2024-01-27
**Test:** `filterStaleEvents > mixed timestamps > keeps events exactly at the boundary (cutoff time is inclusive)`
**Location:** `src/telemetry/telemetry-upload.test.ts:122`
**Status:** ✅ Fixed

---

## Issue Summary

The test was failing intermittently with:
```
error: expect(received).toHaveLength(expected)
Expected length: 1
Received length: 0
```

The test expected events exactly at the 30-day cutoff to be kept (boundary inclusive: `>= cutoff`), but they were being incorrectly removed.

---

## Root Cause

**Race Condition in Test Setup**

The test exhibited a timing-based race condition between:
1. **Timestamp Creation** - `makeTimestamp(-maxAge)` calls `Date.now()`
2. **Event Filtering** - `filterStaleEvents()` calls `Date.now()` again

Any time elapsed between these two calls caused the boundary event to become "too old" by exactly the elapsed time in milliseconds.

### Reproduction Evidence

Running 100 iterations without mocking showed the race condition:
- **Passed:** 1 time
- **Failed:** 99 times

The implementation was actually **correct** (`eventTime >= cutoffTime`), but the test was **flaky** due to the race condition.

### Technical Details

```typescript
// In test (time T0):
const boundaryTimestamp = makeTimestamp(-maxAge);  // Creates timestamp at T0 - 30 days

// Small delay (even 1ms)...

// In filterStaleEvents (time T0 + δ):
const now = Date.now();                             // Uses T0 + δ
const cutoffTime = now - maxAge;                    // Cutoff is now (T0 + δ) - 30 days
const eventTime = Date.parse(boundaryTimestamp);    // Event is at T0 - 30 days

// Result: eventTime < cutoffTime by δ milliseconds!
// Event gets incorrectly filtered out despite being at the boundary
```

---

## The Fix

**Mock `Date.now()` to ensure consistent time reference**

```typescript
test("keeps events exactly at the boundary (cutoff time is inclusive)", () => {
  // Mock Date.now() to prevent race condition
  const fixedNow = 1672531200000; // 2023-01-01T00:00:00.000Z
  const dateNowSpy = spyOn(Date, "now").mockReturnValue(fixedNow);

  try {
    const boundaryEvent = makeEvent(makeTimestamp(-maxAge));
    const result = filterStaleEvents([boundaryEvent]);

    // Events at exactly cutoff time should be kept (>= cutoff)
    expect(result.valid).toHaveLength(1);
    expect(result.staleCount).toBe(0);
  } finally {
    dateNowSpy.mockRestore();
  }
});
```

### Why This Works

1. **Fixed Time Reference:** Both `makeTimestamp()` and `filterStaleEvents()` now use the same `Date.now()` value (1672531200000)
2. **No Time Delta:** Zero elapsed time between timestamp creation and filtering
3. **Deterministic:** Test passes 100% of the time regardless of system timing

---

## Files Modified

### `src/telemetry/telemetry-upload.test.ts`

**Change 1:** Added `spyOn` import
```diff
-import { describe, expect, test, beforeEach, afterEach } from "bun:test";
+import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
```

**Change 2:** Added Date.now() mocking to boundary tests (lines 122-161)
- Mocked `Date.now()` in "keeps events exactly at the boundary" test
- Mocked `Date.now()` in "removes events just before the boundary" test
- Added try-finally blocks to ensure mock restoration

---

## Verification

### Test Results

```bash
# Specific test file
bun test src/telemetry/telemetry-upload.test.ts
✓ 26 pass, 0 fail

# Full test suite
bun test
✓ 2018 pass, 0 fail
```

### Affected Tests
- ✅ `filterStaleEvents > mixed timestamps > keeps events exactly at the boundary (cutoff time is inclusive)`
- ✅ `filterStaleEvents > mixed timestamps > removes events just before the boundary`

---

## Prevention Recommendations

### For Future Tests

1. **Mock Time Dependencies:** Always mock `Date.now()`, `new Date()`, or similar when testing time-based logic
2. **Document Race Conditions:** Add comments explaining why mocking is necessary
3. **Use Test Utilities:** Consider creating a test utility for time-sensitive tests:
   ```typescript
   function withFixedTime<T>(fixedNow: number, fn: () => T): T {
     const spy = spyOn(Date, "now").mockReturnValue(fixedNow);
     try {
       return fn();
     } finally {
       spy.mockRestore();
     }
   }
   ```

### General Best Practices

- **Avoid Real-Time Dependencies:** Don't rely on actual system time in unit tests
- **Test Flakiness:** If a test passes sometimes and fails other times, suspect a race condition
- **Boundary Conditions:** Always test exact boundaries with mocked time to ensure precision
- **Millisecond Precision:** Even 1ms can cause test failures in time-based logic

---

## Additional Notes

### Why the Implementation Was Correct

The `filterStaleEvents` function at `src/telemetry/telemetry-upload.ts:140` always used the correct comparison:

```typescript
if (eventTime >= cutoffTime) {  // ✅ Inclusive boundary (>=)
  valid.push(event);
}
```

This was never the issue - the problem was entirely in the test setup.

### Impact

- **Before Fix:** Test failed 99% of the time (race condition)
- **After Fix:** Test passes 100% of the time (deterministic)
- **Production Code:** No changes needed (was already correct)

---

## Conclusion

The boundary condition bug was a **test infrastructure issue**, not a logic bug in the implementation. The fix ensures test reliability by eliminating the race condition through time mocking, making the test deterministic and preventing it from blocking the pre-commit hook.

**Status:** Ready for commit ✅
