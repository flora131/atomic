---
name: workflow-debugging
description: Systematic debugging workflow - investigate root cause, analyze patterns, test hypotheses, then implement fix
---

# Systematic Debugging

## Description

This skill provides a structured four-phase debugging framework that ensures you understand the problem before attempting solutions. Many bugs reoccur because root causes weren't identified.

## When to Use

- **Any bug, test failure, or unexpected behavior**
- **Before proposing fixes** - investigate first
- **When error messages appear** - trace to root cause
- **When behavior doesn't match expectations**
- **Production issues** - methodical approach prevents rushed, wrong fixes

## Prerequisites

- Ability to reproduce the bug (or understand reproduction steps)
- Access to relevant logs, error messages, or stack traces
- Understanding of expected vs actual behavior

## Instructions

### Phase 1: Root Cause Investigation

**Goal: Understand WHY the bug occurs, not just WHERE**

1. **Reproduce the bug reliably**
   - Document exact steps to reproduce
   - Identify which conditions trigger it
   - Note: if you can't reproduce it, focus on gathering more information

2. **Gather all available information**
   - Error messages and stack traces
   - Logs from before/during/after the issue
   - User input or data that triggered it
   - System state (environment variables, config, etc.)

3. **Trace backwards through the call stack**
   - Start at the error point
   - Work backwards: what called this? What called that?
   - Identify where invalid data originated or logic diverged

4. **Add instrumentation if needed**
   - Add logging/print statements at key points
   - Log variable values, function inputs/outputs
   - Use debugger breakpoints for step-through analysis

5. **Identify the root cause**
   - Don't stop at the symptom (e.g., "variable was null")
   - Ask "why" repeatedly: Why was it null? Why wasn't it validated? Why was that path taken?
   - Root cause is usually architectural or logical, not just "missing check"

### Phase 2: Pattern Analysis

**Goal: Determine if this is a specific bug or symptom of a larger problem**

6. **Check for similar patterns**
   - Search codebase for similar code structures
   - Are other locations vulnerable to the same issue?
   - Is this part of a category of bugs? (e.g., all input validation missing)

7. **Identify contributing factors**
   - Missing validation/sanitization?
   - Race condition or timing issue?
   - Incorrect assumptions about data?
   - Architectural flaw?

8. **Assess scope of impact**
   - Is this a single occurrence or systemic?
   - Does it affect other features/modules?
   - What's the blast radius if unfixed?

### Phase 3: Hypothesis Testing

**Goal: Validate your understanding before implementing a fix**

9. **Form a hypothesis**
   - "The bug occurs because [specific cause]"
   - "If I change [X], then [Y] should happen"
   - Make it specific and falsifiable

10. **Test the hypothesis WITHOUT changing production code**
    - Write a test that exposes the bug (RED phase from TDD)
    - Add temporary logging to verify your theory
    - Use debugger to step through and confirm

11. **Validate or refine hypothesis**
    - If test confirms bug: hypothesis validated ✓
    - If test doesn't expose bug: hypothesis was wrong, revise
    - Never proceed to fix until hypothesis is validated

### Phase 4: Implementation

**Goal: Fix the root cause, not just the symptom**

12. **Design the fix**
    - Address the root cause identified in Phase 1
    - Consider pattern analysis from Phase 2
    - If systemic, fix all instances (not just the reported one)

13. **Implement the fix**
    - Make minimal changes necessary
    - Add/fix validation, error handling, or logic
    - Update tests to cover this bug (prevent regression)

14. **Verify the fix**
    - Run the test that exposed the bug (should pass now)
    - Run full test suite (ensure no regressions)
    - Manually test the reproduction steps
    - Verify similar patterns were also fixed

15. **Add defensive measures**
    - Add validation at boundaries
    - Improve error messages for future debugging
    - Add logging if this area is prone to issues
    - Document gotchas if behavior is non-obvious

## Critical Rules

- **NEVER propose a fix before understanding root cause**
- **ALWAYS trace back to the origin**, not just the symptom
- **ALWAYS write/update tests** to prevent regression
- **NEVER assume** - validate hypotheses with evidence
- **If you can't reproduce it, gather more information** before guessing

## Examples

### Example 1: JavaScript - Null Reference Error

**Phase 1: Root Cause Investigation**
```
Error: Cannot read property 'name' of undefined
at getUserProfile (user-service.js:45)

Stack trace analysis:
getUserProfile() ← API endpoint /api/profile ← HTTP GET

Investigation:
- Line 45: const name = user.name
- user is undefined
- Why? getUserById(userId) returned undefined
- Why? userId was invalid (came from query param without validation)

ROOT CAUSE: Missing input validation on userId parameter
```

**Phase 2: Pattern Analysis**
```
Search codebase for similar patterns:
- Found 8 other endpoints using query params without validation
- This is a systemic input validation issue
- Impact: All 8 endpoints vulnerable to similar crashes
```

**Phase 3: Hypothesis Testing**
```javascript
// Test that exposes the bug
describe('GET /api/profile', () => {
  it('should return 400 when userId is invalid', () => {
    const response = request.get('/api/profile?userId=invalid');
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('Invalid userId');
  });
});
```
Run test → FAILS (current code crashes with 500) ✓ Hypothesis validated

**Phase 4: Implementation**
```javascript
// Fix with input validation
async function getUserProfile(req, res) {
  const { userId } = req.query;

  // Validation at boundary
  if (!userId || !isValidUserId(userId)) {
    return res.status(400).json({
      error: 'Invalid userId parameter'
    });
  }

  const user = await getUserById(userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({ name: user.name, email: user.email });
}
```

Run tests → PASSES ✓
Apply same fix to 8 other vulnerable endpoints ✓

### Example 2: Python - Race Condition in Concurrent Code

**Phase 1: Root Cause Investigation**
```
Error: List index out of range (intermittent)
at process_batch (worker.py:78)

Investigation:
- Bug only appears under load (multiple threads)
- Line 78: item = work_queue[i]
- work_queue is shared between threads without synchronization
- Another thread removes items while this thread iterates

ROOT CAUSE: Race condition - shared mutable state without locks
```

**Phase 2: Pattern Analysis**
```
Check for similar patterns:
- Found 3 other places with shared lists/dicts across threads
- All lack synchronization mechanisms
- Pattern: Legacy code before async/threading was added
```

**Phase 3: Hypothesis Testing**
```python
# Test that exposes the race condition
import threading
import pytest

def test_concurrent_batch_processing():
    work_queue = list(range(100))
    errors = []

    def worker():
        try:
            process_batch(work_queue)
        except IndexError as e:
            errors.append(e)

    threads = [threading.Thread(target=worker) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0, f"Race condition detected: {errors}"
```
Run test (repeatedly) → FAILS intermittently ✓ Hypothesis validated

**Phase 4: Implementation**
```python
import threading
from queue import Queue

# Fix: Use thread-safe queue instead of shared list
work_queue = Queue()

def process_batch():
    while not work_queue.empty():
        try:
            item = work_queue.get(timeout=1)
            # Process item
            work_queue.task_done()
        except Empty:
            break
```

Run tests (100 times) → ALL PASS ✓
Apply queue pattern to 3 other vulnerable locations ✓

## Validation

After completing the debugging process, verify:

- ✅ Root cause identified (not just symptom)
- ✅ Hypothesis was tested before implementing fix
- ✅ Fix addresses root cause, not just the reported instance
- ✅ Test added to prevent regression
- ✅ Similar patterns were also fixed (if applicable)
- ✅ All tests pass (no regressions introduced)
- ✅ Bug is no longer reproducible

## Common Pitfalls to Avoid

1. **Fixing symptoms instead of root cause** - Bug will return in different form
2. **Guessing without investigation** - Wastes time on wrong solutions
3. **Not writing tests** - Bug will resurface later
4. **Fixing only the reported instance** - Other instances will bite later
5. **Insufficient logging** - Makes future debugging harder
6. **Assuming you know the cause** - Validate with evidence

## Related Skills

- `workflow-tdd` - Tests should prevent bugs from occurring
- `domain-performance` - Performance issues require similar investigation
- `tools-git-workflow` - Use git blame/log to understand code history

## Debugging Tools by Language

- **JavaScript/TypeScript**: Chrome DevTools, Node debugger, console.log
- **Python**: pdb, logging module, pytest with -v flag
- **Ruby**: byebug, binding.pry, RSpec with --format documentation
- **Go**: delve, fmt.Printf, go test -v
- **Java**: IntelliJ debugger, System.out.println, JUnit verbose output
