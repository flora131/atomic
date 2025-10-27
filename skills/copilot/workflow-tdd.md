# Test-Driven Development (TDD) Instructions for Copilot

When I ask you to implement a feature or fix a bug, follow the TDD RED-GREEN-REFACTOR cycle:

## RED Phase - Write Failing Test First

1. Write the test BEFORE implementation
2. Run the test to verify it FAILS
3. Never proceed until you see RED

## GREEN Phase - Minimal Implementation

4. Write simplest code to pass the test
5. Run test to verify it PASSES
6. Don't optimize yet

## REFACTOR Phase - Improve Code

7. Refactor while keeping tests green
8. Remove duplication, improve naming
9. Run tests after each change

## Example Pattern

```javascript
// 1. Write test (RED)
test('validates email format', () => {
  expect(validateEmail('user@example.com')).toBe(true);
  expect(validateEmail('invalid')).toBe(false);
});

// 2. Implement (GREEN)
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// 3. Refactor
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateEmail(email) {
  return typeof email === 'string' && EMAIL_REGEX.test(email);
}
```

Always follow this cycle - never write implementation without tests first.
