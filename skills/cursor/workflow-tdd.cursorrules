# Test-Driven Development (TDD)

When implementing features or fixing bugs, follow the RED-GREEN-REFACTOR cycle:

## Phase 1: RED - Write a Failing Test

1. Write the test FIRST before any implementation code
   - Name tests descriptively (describe what behavior they test)
   - Call functions/methods that don't exist yet
   - Assert expected outcomes

2. Run the test and VERIFY IT FAILS
   - Confirm it fails for the RIGHT reason (not syntax errors)
   - If it passes without implementation, the test is wrong
   - NEVER proceed to implementation until you see RED

## Phase 2: GREEN - Write Minimal Implementation

3. Write the SIMPLEST code to make the test pass
   - Focus solely on passing the test
   - Don't worry about elegance yet

4. Run the test and VERIFY IT PASSES
   - Ensure no other tests broke (regression check)
   - NEVER skip running tests

## Phase 3: REFACTOR - Improve the Code

5. Refactor while keeping tests green
   - Remove duplication
   - Improve naming and structure
   - Apply design patterns if appropriate

6. Run tests after each refactoring change
   - If tests fail, undo or fix the refactoring

## Critical Rules

- NEVER write implementation before tests
- ALWAYS run tests to see them fail (RED) before implementing
- ALWAYS run tests to see them pass (GREEN) after implementing
- NEVER skip the REFACTOR phase
- One test at a time - complete the full cycle before the next test

## Quick Example

```javascript
// 1. RED - Write failing test
test('validateEmail returns true for valid emails', () => {
  expect(validateEmail('user@example.com')).toBe(true);
});
// Run test → FAILS ✓

// 2. GREEN - Implement
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
// Run test → PASSES ✓

// 3. REFACTOR - Improve
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(email) {
  if (typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}
// Run test → STILL PASSES ✓
```

Apply this workflow whenever implementing new functionality or fixing bugs.
