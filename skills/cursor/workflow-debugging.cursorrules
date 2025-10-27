# Systematic Debugging

When encountering bugs, test failures, or unexpected behavior, follow this four-phase framework:

## Phase 1: Root Cause Investigation

1. **Reproduce the bug reliably**
   - Document exact steps to reproduce
   - Identify triggering conditions

2. **Gather all available information**
   - Error messages and stack traces
   - Logs from before/during/after the issue
   - User input or data that triggered it

3. **Trace backwards through the call stack**
   - Start at the error point
   - Work backwards: what called this? What called that?
   - Identify where invalid data originated

4. **Add instrumentation if needed**
   - Add logging at key points
   - Log variable values, function inputs/outputs
   - Use debugger breakpoints

5. **Identify the root cause**
   - Don't stop at the symptom (e.g., "variable was null")
   - Ask "why" repeatedly until you find the actual cause

## Phase 2: Pattern Analysis

6. **Check for similar patterns**
   - Search codebase for similar code structures
   - Are other locations vulnerable to the same issue?

7. **Identify contributing factors**
   - Missing validation?
   - Race condition?
   - Incorrect assumptions?

8. **Assess scope of impact**
   - Is this a single occurrence or systemic?
   - Does it affect other features/modules?

## Phase 3: Hypothesis Testing

9. **Form a specific hypothesis**
   - "The bug occurs because [specific cause]"
   - Make it specific and falsifiable

10. **Test hypothesis WITHOUT changing production code**
    - Write a test that exposes the bug (RED phase from TDD)
    - Add temporary logging to verify theory
    - Use debugger to step through

11. **Validate or refine hypothesis**
    - If test confirms bug: hypothesis validated ✓
    - If test doesn't expose bug: hypothesis wrong, revise

## Phase 4: Implementation

12. **Design the fix**
    - Address the root cause, not just the symptom
    - If systemic, fix all instances

13. **Implement the fix**
    - Make minimal necessary changes
    - Add/fix tests to prevent regression

14. **Verify the fix**
    - Run test that exposed the bug (should pass now)
    - Run full test suite (ensure no regressions)
    - Manually test reproduction steps

## Critical Rules

- NEVER propose a fix before understanding root cause
- ALWAYS trace back to the origin, not just the symptom
- ALWAYS write/update tests to prevent regression
- NEVER assume - validate hypotheses with evidence

Apply this systematic approach to all bugs to ensure complete fixes.
