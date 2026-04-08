# Code Review Checklist

## Critical Issues (Block Merge)

### React Hooks

- [ ] No `useEffect` that only computes derived state
- [ ] No missing cleanup functions (subscriptions, timers, fetch)
- [ ] No conditional hook calls (`if (x) { useState() }`)
- [ ] Dependency arrays are complete and correct
- [ ] No `eslint-disable react-hooks/exhaustive-deps` without strong justification

### State Management

- [ ] No direct state mutations (`.push()`, `.splice()`, `arr[i] = x`)
- [ ] No copying server data to local state (TanStack Query data → useState)
- [ ] State is colocated near where it's used

### React 19 Specific

- [ ] `useFormStatus` called in child component, not same component as `<form>`
- [ ] Promises passed to `use()` are not created inline in render
- [ ] Server Actions have `'use server'` directive
- [ ] `'use client'` boundary is as low as possible in component tree

### Keys

- [ ] No `index` as key in lists that can reorder, filter, or add/remove items
- [ ] Keys are stable and unique within siblings

### TypeScript

- [ ] No `any` type without explicit justification comment
- [ ] Array access handles possible `undefined` (or `noUncheckedIndexedAccess` enabled)
- [ ] Props interfaces use discriminated unions for mutually exclusive props

---

## High Priority Issues

### Component Structure

- [ ] No component defined inside another component (causes remount)
- [ ] Components under 300 lines (split if larger)
- [ ] Single responsibility - one reason to change

### Props and State

- [ ] Controlled inputs initialized with empty string, not `undefined`
- [ ] Props typed explicitly (not using `React.FC` with generics)
- [ ] No prop drilling beyond 2-3 levels

### Performance

- [ ] `useMemo`/`useCallback` justified by measurement or `React.memo` child
- [ ] No inline object/function in JSX passed to memoized children
- [ ] Large lists use virtualization (react-window, react-virtual)

### Error Handling

- [ ] Error boundaries at appropriate granularity
- [ ] Async operations have error handling
- [ ] Form validation shows clear error messages

---

## Architecture Checks

### Custom Hooks

- [ ] Hook names start with `use` followed by capital letter
- [ ] Hooks are reusable or significantly improve readability
- [ ] Non-hook logic extracted to utility functions instead

### State Management Strategy

- [ ] Server state uses TanStack Query (or similar)
- [ ] Client state uses appropriate solution:
  - Local: `useState`/`useReducer`
  - Global simple: Zustand
  - Global derived: Jotai
- [ ] Form state uses React 19 `useActionState` where appropriate

### File Organization

- [ ] Feature-based folder structure for larger apps
- [ ] No barrel files (`index.ts`) in application code
- [ ] Shared components in `components/`
- [ ] Feature-specific code in `features/<name>/`

---

## TypeScript Quality

### Type Safety

- [ ] Strict mode enabled (`"strict": true`)
- [ ] `noUncheckedIndexedAccess: true` for array safety
- [ ] Generic components preserve type inference
- [ ] Event handlers properly typed (`React.MouseEvent<HTMLButtonElement>`)

### Type Patterns

- [ ] Discriminated unions for variant props
- [ ] `as const` for literal types where appropriate
- [ ] Explicit return types on exported functions
- [ ] No type assertions (`as`) without comment explaining why

### Context Typing

- [ ] Context created with `null` default has custom hook with null check
- [ ] Provider value is memoized if object

```typescript
// ✅ Correct context pattern
const MyContext = createContext<ContextType | null>(null);

function useMyContext() {
  const ctx = useContext(MyContext);
  if (!ctx) throw new Error('useMyContext must be within MyProvider');
  return ctx;
}

function MyProvider({ children }: { children: ReactNode }) {
  const value = useMemo(() => ({ /* ... */ }), [deps]);
  return <MyContext value={value}>{children}</MyContext>;
}
```

---

## Performance Checks

### Re-render Prevention

- [ ] `React.memo` used for expensive pure components
- [ ] Callbacks passed to memoized children are stable (`useCallback`)
- [ ] Object props to memoized children are stable (`useMemo`)
- [ ] Zustand selectors select minimal state

### Bundle Size

- [ ] Route-level code splitting with `React.lazy`
- [ ] Heavy libraries imported dynamically where possible
- [ ] No unused dependencies
- [ ] Tree-shaking friendly imports (no `import * as`)

### Lists and Tables

- [ ] Virtualization for 100+ items
- [ ] Stable keys for all list items
- [ ] Filtered/sorted lists memoized if expensive

---

## Accessibility (a11y)

### Semantic HTML

- [ ] Interactive elements are `<button>`, `<a>`, `<input>`, etc. (not `<div onClick>`)
- [ ] Headings follow hierarchy (`h1` → `h2` → `h3`)
- [ ] Lists use `<ul>`/`<ol>`/`<li>`

### Forms

- [ ] All inputs have associated `<label>` (via `htmlFor` or wrapping)
- [ ] Required fields indicated visually and via `aria-required`
- [ ] Error messages associated via `aria-describedby`

### Keyboard Navigation

- [ ] All interactive elements focusable
- [ ] Visible focus indicators (don't remove `outline`)
- [ ] `tabIndex` used appropriately (0 or -1, rarely positive)

### Screen Readers

- [ ] Images have meaningful `alt` text (or `alt=""` if decorative)
- [ ] Icons have `aria-label` or `aria-hidden="true"`
- [ ] Dynamic content updates announced (`aria-live`)

### Links

- [ ] External links have `rel="noopener noreferrer"` with `target="_blank"`
- [ ] Link text is descriptive (not "click here")

---

## Testing Standards

### Query Priority

Use queries in this order (Testing Library best practice):

1. `getByRole` - accessible to everyone
2. `getByLabelText` - form fields
3. `getByPlaceholderText` - if no label
4. `getByText` - non-interactive elements
5. `getByTestId` - last resort

### Test Quality

- [ ] Tests verify behavior, not implementation
- [ ] `userEvent` used instead of `fireEvent`
- [ ] Async operations use `waitFor` or `findBy`
- [ ] Error states covered
- [ ] Edge cases covered (empty state, loading, error)

### Test Structure

- [ ] Arrange-Act-Assert pattern
- [ ] One assertion focus per test (can have multiple asserts)
- [ ] Test descriptions explain expected behavior
- [ ] No test interdependencies

---

## Quick Reference: Common Issues by Symptom

| Symptom | Likely Cause | Check |
|---------|--------------|-------|
| Infinite re-renders | Object in dependency array | New object created each render? |
| Stale state in callback | Missing dependency | Closure over old value? |
| State doesn't update | Direct mutation | Using `.push()` or direct assignment? |
| Controlled input warning | `undefined` initial value | Initialize with empty string |
| Hook error | Conditional hook call | Hook inside `if`/loop? |
| Memory leak warning | Missing cleanup | Subscription/timer without cleanup? |
| Type error on array access | Missing undefined check | Enable `noUncheckedIndexedAccess` |
| Child re-renders unnecessarily | Unstable props | Inline object/function to memo child? |
| Form status always false | Wrong component | `useFormStatus` in form component? |

---

## Review Comment Templates

### Critical Issue

```
🚫 **Critical:** [Issue description]

This will cause [bug/leak/crash] because [reason].

**Current:**
```code```

**Should be:**
```code```
```

### Suggestion

```
💡 **Suggestion:** [Improvement description]

This would improve [maintainability/performance/readability] by [reason].

**Consider:**
```code```
```

### Question

```
❓ **Question:** [Clarification needed]

Is this intentional? [Context for why you're asking]
```