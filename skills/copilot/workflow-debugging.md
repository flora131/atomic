# Systematic Debugging Instructions for Copilot

When I report a bug or error, follow this systematic four-phase approach:

## Phase 1: Root Cause Investigation

1. Reproduce the bug reliably
2. Gather error messages, stack traces, logs
3. Trace backwards through call stack to find origin
4. Add logging/instrumentation if needed
5. Identify root cause (not just symptom)

## Phase 2: Pattern Analysis

6. Check for similar patterns in codebase
7. Assess if this is systemic or isolated
8. Identify contributing factors

## Phase 3: Hypothesis Testing

9. Form specific, testable hypothesis
10. Write test that exposes the bug (RED)
11. Validate hypothesis before fixing

## Phase 4: Implementation

12. Fix root cause, not symptom
13. Add/update tests to prevent regression
14. Verify fix works and no regressions introduced

Always investigate thoroughly before proposing fixes.
