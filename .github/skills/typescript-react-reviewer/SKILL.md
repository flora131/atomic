---
name: typescript-react-reviewer
description: "Expert code reviewer for TypeScript + React 19 applications. Use when reviewing React code, identifying anti-patterns, evaluating state management, or assessing code maintainability. Triggers: code review requests, PR reviews, React architecture evaluation, identifying code smells, TypeScript type safety checks, useEffect abuse detection, state management review."
---

# TypeScript + React 19 Code Review Expert

Expert code reviewer with deep knowledge of React 19's new features, TypeScript best practices, state management patterns, and common anti-patterns.

## Review Priority Levels

### 🚫 Critical (Block Merge)

These issues cause bugs, memory leaks, or architectural problems:

| Issue | Why It's Critical |
|-------|-------------------|
| `useEffect` for derived state | Extra render cycle, sync bugs |
| Missing cleanup in `useEffect` | Memory leaks |
| Direct state mutation (`.push()`, `.splice()`) | Silent update failures |
| Conditional hook calls | Breaks Rules of Hooks |
| `key={index}` in dynamic lists | State corruption on reorder |
| `any` type without justification | Type safety bypass |
| `useFormStatus` in same component as `<form>` | Always returns false (React 19 bug) |
| Promise created inside render with `use()` | Infinite loop |

### ⚠️ High Priority

| Issue | Impact |
|-------|--------|
| Incomplete dependency arrays | Stale closures, missing updates |
| Props typed as `any` | Runtime errors |
| Unjustified `useMemo`/`useCallback` | Unnecessary complexity |
| Missing Error Boundaries | Poor error UX |
| Controlled input initialized with `undefined` | React warning |

### 📝 Architecture/Style

| Issue | Recommendation |
|-------|----------------|
| Component > 300 lines | Split into smaller components |
| Prop drilling > 2-3 levels | Use composition or context |
| State far from usage | Colocate state |
| Custom hooks without `use` prefix | Follow naming convention |

## Quick Detection Patterns

### useEffect Abuse (Most Common Anti-Pattern)

```typescript
// ❌ WRONG: Derived state in useEffect
const [firstName, setFirstName] = useState('');
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);

// ✅ CORRECT: Compute during render
const fullName = firstName + ' ' + lastName;
```

```typescript
// ❌ WRONG: Event logic in useEffect
useEffect(() => {
  if (product.isInCart) showNotification('Added!');
}, [product]);

// ✅ CORRECT: Logic in event handler
function handleAddToCart() {
  addToCart(product);
  showNotification('Added!');
}
```

### React 19 Hook Mistakes

```typescript
// ❌ WRONG: useFormStatus in form component (always returns false)
function Form() {
  const { pending } = useFormStatus();
  return <form action={submit}><button disabled={pending}>Send</button></form>;
}

// ✅ CORRECT: useFormStatus in child component
function SubmitButton() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>Send</button>;
}
function Form() {
  return <form action={submit}><SubmitButton /></form>;
}
```

```typescript
// ❌ WRONG: Promise created in render (infinite loop)
function Component() {
  const data = use(fetch('/api/data')); // New promise every render!
}

// ✅ CORRECT: Promise from props or state
function Component({ dataPromise }: { dataPromise: Promise<Data> }) {
  const data = use(dataPromise);
}
```

### State Mutation Detection

```typescript
// ❌ WRONG: Mutations (no re-render)
items.push(newItem);
setItems(items);

arr[i] = newValue;
setArr(arr);

// ✅ CORRECT: Immutable updates
setItems([...items, newItem]);
setArr(arr.map((x, idx) => idx === i ? newValue : x));
```

### TypeScript Red Flags

```typescript
// ❌ Red flags to catch
const data: any = response;           // Unsafe any
const items = arr[10];                // Missing undefined check
const App: React.FC<Props> = () => {}; // Discouraged pattern

// ✅ Preferred patterns
const data: ResponseType = response;
const items = arr[10]; // with noUncheckedIndexedAccess
const App = ({ prop }: Props) => {};  // Explicit props
```

## Review Workflow

1. **Scan for critical issues first** - Check for the patterns in "Critical (Block Merge)" section
2. **Check React 19 usage** - See [react19-patterns.md](references/react19-patterns.md) for new API patterns
3. **Evaluate state management** - Is state colocated? Server state vs client state separation?
4. **Assess TypeScript safety** - Generic components, discriminated unions, strict config
5. **Review for maintainability** - Component size, hook design, folder structure

## Reference Documents

For detailed patterns and examples:

- **[react19-patterns.md](references/react19-patterns.md)** - React 19 new hooks (useActionState, useOptimistic, use), Server/Client Component boundaries
- **[antipatterns.md](references/antipatterns.md)** - Comprehensive anti-pattern catalog with fixes
- **[checklist.md](references/checklist.md)** - Full code review checklist for thorough reviews

## State Management Quick Guide

| Data Type | Solution |
|-----------|----------|
| Server/async data | TanStack Query (never copy to local state) |
| Simple global UI state | Zustand (~1KB, no Provider) |
| Fine-grained derived state | Jotai (~2.4KB) |
| Component-local state | useState/useReducer |
| Form state | React 19 useActionState |

### TanStack Query Anti-Pattern

```typescript
// ❌ NEVER copy server data to local state
const { data } = useQuery({ queryKey: ['todos'], queryFn: fetchTodos });
const [todos, setTodos] = useState([]);
useEffect(() => setTodos(data), [data]);

// ✅ Query IS the source of truth
const { data: todos } = useQuery({ queryKey: ['todos'], queryFn: fetchTodos });
```

## TypeScript Config Recommendations

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true
  }
}
```

`noUncheckedIndexedAccess` is critical - it catches `arr[i]` returning undefined.

## Immediate Red Flags

When reviewing, flag these immediately:

| Pattern | Problem | Fix |
|---------|---------|-----|
| `eslint-disable react-hooks/exhaustive-deps` | Hides stale closure bugs | Refactor logic |
| Component defined inside component | Remounts every render | Move outside |
| `useState(undefined)` for inputs | Uncontrolled warning | Use empty string |
| `React.FC` with generics | Generic inference breaks | Use explicit props |
| Barrel files (`index.ts`) in app code | Bundle bloat, circular deps | Direct imports |