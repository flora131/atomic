---
name: workflow-tdd
description: Test-Driven Development workflow - write tests first, watch them fail, implement minimal code to pass, then refactor
---

# Test-Driven Development (TDD)

## Description

This skill guides you through the Test-Driven Development (RED-GREEN-REFACTOR) cycle. TDD ensures that code is thoroughly tested and that tests actually verify behavior by requiring failure first.

## When to Use

- **Implementing any feature or bugfix** before writing implementation code
- **User requests adding functionality** or fixing a bug
- **Before modifying existing code** to ensure changes don't break functionality
- **When you're tempted to write implementation first** - STOP and write the test instead

## Prerequisites

- Understand the feature or bugfix requirements
- Know what testing framework the project uses (Jest, pytest, RSpec, etc.)
- Identify where test files should live in the project structure

## Instructions

### Phase 1: RED - Write a Failing Test

1. **Clarify requirements** if they're unclear
   - Ask specific questions about expected behavior
   - Identify edge cases and error conditions

2. **Write the test FIRST** before any implementation code
   - Name the test descriptively (describe what behavior it tests)
   - Set up test data/fixtures
   - Call the function/method that doesn't exist yet (or exists but doesn't have this behavior)
   - Assert the expected outcome

3. **Run the test and VERIFY IT FAILS**
   - Execute the test suite
   - Confirm the test fails for the RIGHT reason (not syntax errors)
   - If it passes without implementation, the test is wrong - fix it
   - **NEVER proceed to implementation until you see RED**

### Phase 2: GREEN - Write Minimal Implementation

4. **Write the SIMPLEST code to make the test pass**
   - Don't worry about elegance or optimization yet
   - Focus solely on passing the test
   - Hardcoding is acceptable if it passes the test

5. **Run the test and VERIFY IT PASSES**
   - Execute the test suite
   - Confirm the specific test turns GREEN
   - Ensure no other tests broke (regression check)
   - **NEVER skip running tests to "save time"**

### Phase 3: REFACTOR - Improve the Code

6. **Refactor while keeping tests green**
   - Remove duplication
   - Improve naming and structure
   - Apply design patterns if appropriate
   - Optimize performance if needed

7. **Run tests after each refactoring change**
   - Confirm all tests still pass
   - If tests fail, undo the refactoring or fix it

8. **Repeat the cycle** for the next piece of functionality

## Critical Rules

- **NEVER write implementation before tests**
- **ALWAYS run tests to see them fail (RED) before implementing**
- **ALWAYS run tests to see them pass (GREEN) after implementing**
- **NEVER skip the REFACTOR phase** - technical debt accumulates quickly
- **One test at a time** - complete the RED-GREEN-REFACTOR cycle before writing the next test

## Examples

### Example 1: JavaScript/Jest - Adding a validation function

**RED Phase:**
```javascript
// tests/validators.test.js
describe('validateEmail', () => {
  it('should return true for valid email addresses', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('test.user+tag@domain.co.uk')).toBe(true);
  });

  it('should return false for invalid email addresses', () => {
    expect(validateEmail('notanemail')).toBe(false);
    expect(validateEmail('@example.com')).toBe(false);
    expect(validateEmail('user@')).toBe(false);
  });
});
```

Run tests → **FAILS** (validateEmail is not defined) ✓

**GREEN Phase:**
```javascript
// src/validators.js
function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

module.exports = { validateEmail };
```

Run tests → **PASSES** ✓

**REFACTOR Phase:**
```javascript
// src/validators.js
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email) {
  if (typeof email !== 'string') return false;
  return EMAIL_REGEX.test(email.trim());
}

module.exports = { validateEmail };
```

Run tests → **STILL PASSES** ✓

### Example 2: Python/pytest - Adding a data processing function

**RED Phase:**
```python
# tests/test_processor.py
import pytest
from processor import calculate_average

def test_calculate_average_with_valid_numbers():
    assert calculate_average([1, 2, 3, 4, 5]) == 3.0
    assert calculate_average([10, 20]) == 15.0

def test_calculate_average_with_empty_list():
    with pytest.raises(ValueError, match="Cannot calculate average of empty list"):
        calculate_average([])
```

Run tests → **FAILS** (calculate_average doesn't exist) ✓

**GREEN Phase:**
```python
# processor.py
def calculate_average(numbers):
    if not numbers:
        raise ValueError("Cannot calculate average of empty list")
    return sum(numbers) / len(numbers)
```

Run tests → **PASSES** ✓

**REFACTOR Phase:**
```python
# processor.py
def calculate_average(numbers):
    """Calculate the arithmetic mean of a list of numbers.

    Args:
        numbers: List of numeric values

    Returns:
        float: The average value

    Raises:
        ValueError: If the list is empty
    """
    if not numbers:
        raise ValueError("Cannot calculate average of empty list")

    return sum(numbers) / len(numbers)
```

Run tests → **STILL PASSES** ✓

## Validation

After completing a TDD cycle, verify:

- ✅ Test was written BEFORE implementation
- ✅ Test failed initially (RED phase observed)
- ✅ Test passes after implementation (GREEN phase achieved)
- ✅ Code was refactored for clarity/quality
- ✅ All tests still pass after refactoring
- ✅ Test actually tests the intended behavior (not just coverage)
- ✅ Edge cases and error conditions are covered

## Common Pitfalls to Avoid

1. **Writing implementation first** - This defeats the purpose; test first ALWAYS
2. **Not running tests to see them fail** - How do you know the test works?
3. **Tests that can't fail** - Tests that always pass are useless
4. **Skipping refactoring** - Technical debt compounds rapidly
5. **Testing implementation details** - Test behavior, not internal structure
6. **Overly complex tests** - If the test is hard to understand, simplify it
7. **Testing multiple things in one test** - One assertion per concept

## Related Skills

- `workflow-debugging` - For when tests reveal bugs
- `workflow-code-review` - Review should verify TDD was followed
- `tools-testing-frameworks` - For framework-specific testing patterns

## Additional Resources

- Tests should be placed according to project conventions (typically `tests/`, `__tests__/`, or `*_test.go`)
- Consider adding example test files in subdirectories if project has none
- Reference project's testing documentation if available
