# React + TypeScript Anti-Patterns Catalog

## useEffect Anti-Patterns

### 1. Derived State in useEffect

**Problem:** Extra render cycle, state synchronization bugs.

```typescript
// ❌ ANTI-PATTERN
const [firstName, setFirstName] = useState('Taylor');
const [lastName, setLastName] = useState('Swift');
const [fullName, setFullName] = useState('');

useEffect(() => {
  setFullName(firstName + ' ' + lastName); // Extra render!
}, [firstName, lastName]);

// ✅ CORRECT: Calculate during render
const fullName = firstName + ' ' + lastName;
```

**Detection:** `useEffect` that only calls `setState` with computed values from dependencies.

### 2. Event Logic in useEffect

**Problem:** Side effect runs on mount/remount, not just on user action.

```typescript
// ❌ ANTI-PATTERN: Notification shows on page reload too
useEffect(() => {
  if (product.isInCart) {
    showNotification(`Added ${product.name}!`);
  }
}, [product]);

// ✅ CORRECT: Logic in event handler
function handleBuyClick() {
  addToCart(product);
  showNotification(`Added ${product.name}!`);
}
```

**Detection:** `useEffect` containing UI feedback (toast, modal, notification) triggered by state change.

### 3. Resetting State on Prop Change

**Problem:** Extra render, harder to trace state flow.

```typescript
// ❌ ANTI-PATTERN
function ProfilePage({ userId }: { userId: string }) {
  const [comment, setComment] = useState('');
  
  useEffect(() => {
    setComment(''); // Reset on user change
  }, [userId]);
}

// ✅ CORRECT: Use key to reset
function ProfilePage({ userId }: { userId: string }) {
  return <Profile userId={userId} key={userId} />;
}
```

**Detection:** `useEffect` that resets state when a prop changes.

### 4. Fetching Without Proper Cleanup

**Problem:** Race conditions, memory leaks, setting state on unmounted component.

```typescript
// ❌ ANTI-PATTERN: No cleanup
useEffect(() => {
  fetch(`/api/user/${userId}`)
    .then(res => res.json())
    .then(data => setUser(data)); // May set state after unmount
}, [userId]);

// ✅ CORRECT: AbortController for cleanup
useEffect(() => {
  const controller = new AbortController();
  
  fetch(`/api/user/${userId}`, { signal: controller.signal })
    .then(res => res.json())
    .then(data => setUser(data))
    .catch(err => {
      if (err.name !== 'AbortError') setError(err);
    });
  
  return () => controller.abort();
}, [userId]);

// ✅ BETTER: Use TanStack Query
const { data: user } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => fetch(`/api/user/${userId}`).then(r => r.json()),
});
```

### 5. Missing Cleanup for Subscriptions

**Problem:** Memory leaks, event handlers accumulate.

```typescript
// ❌ ANTI-PATTERN: No cleanup
useEffect(() => {
  window.addEventListener('resize', handleResize);
}, []);

// ✅ CORRECT
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

## Dependency Array Anti-Patterns

### 1. Missing Dependencies (Stale Closures)

```typescript
// ❌ ANTI-PATTERN: count is stale
useEffect(() => {
  const id = setInterval(() => {
    setCount(count + increment); // Uses stale count!
  }, 1000);
  return () => clearInterval(id);
}, []); // Missing count and increment

// ✅ CORRECT: Functional update removes count dependency
useEffect(() => {
  const id = setInterval(() => {
    setCount(c => c + increment);
  }, 1000);
  return () => clearInterval(id);
}, [increment]);
```

### 2. Object/Array Dependencies (Infinite Loops)

```typescript
// ❌ ANTI-PATTERN: New object every render = infinite loop
const options = { userId, page: 1 };
useEffect(() => {
  fetchData(options);
}, [options]); // options is new object every render!

// ✅ CORRECT: Use primitives
useEffect(() => {
  fetchData({ userId, page: 1 });
}, [userId]);

// ✅ ALTERNATIVE: Memoize if object is needed
const options = useMemo(() => ({ userId, page: 1 }), [userId]);
```

### 3. eslint-disable for Dependencies

**This is almost always wrong.** The linter is catching real bugs.

```typescript
// ❌ ANTI-PATTERN: Hiding the bug
useEffect(() => {
  doSomething(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // value will be stale!

// ✅ CORRECT: Fix the actual issue
useEffect(() => {
  doSomething(value);
}, [value]);

// Or if you truly want "mount only", question why:
// - Is this initialization that should be in useState initializer?
// - Is this a subscription that should include cleanup?
```

## State Mutation Anti-Patterns

### Direct Array Mutation

```typescript
// ❌ ANTI-PATTERN: Same reference, no re-render
const addItem = (item: Item) => {
  items.push(item);
  setItems(items); // React sees same reference, skips update
};

// ✅ CORRECT
const addItem = (item: Item) => {
  setItems([...items, item]);
};
```

### Direct Object Mutation

```typescript
// ❌ ANTI-PATTERN
const updateUser = (name: string) => {
  user.name = name;
  setUser(user); // Same reference
};

// ✅ CORRECT
const updateUser = (name: string) => {
  setUser({ ...user, name });
};
```

### Immutable Operations Reference

| Operation | ❌ Mutating | ✅ Immutable |
|-----------|------------|-------------|
| Add | `arr.push(item)` | `[...arr, item]` |
| Add at start | `arr.unshift(item)` | `[item, ...arr]` |
| Remove | `arr.splice(i, 1)` | `arr.filter((_, idx) => idx !== i)` |
| Update | `arr[i] = newItem` | `arr.map((x, idx) => idx === i ? newItem : x)` |
| Sort | `arr.sort()` | `[...arr].sort()` |
| Reverse | `arr.reverse()` | `[...arr].reverse()` |

## Memoization Anti-Patterns

### 1. useMemo for Simple Calculations

```typescript
// ❌ ANTI-PATTERN: Overhead > benefit
const fullName = useMemo(
  () => `${firstName} ${lastName}`,
  [firstName, lastName]
);

// ✅ CORRECT: Just compute it
const fullName = `${firstName} ${lastName}`;
```

**Rule:** Only use `useMemo` for genuinely expensive calculations (>1ms) OR to maintain referential equality for `React.memo` children.

### 2. useCallback Without React.memo

```typescript
// ❌ ANTI-PATTERN: useCallback does nothing here
function Parent() {
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []);
  
  return <Child onClick={handleClick} />; // Child still re-renders!
}

// ✅ CORRECT: Combine with React.memo
const Child = React.memo(function Child({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Click</button>;
});

function Parent() {
  const handleClick = useCallback(() => {
    console.log('clicked');
  }, []);
  
  return <Child onClick={handleClick} />; // Now Child skips re-render
}
```

### 3. Inline Objects/Functions in JSX to Memoized Children

```typescript
// ❌ ANTI-PATTERN: New object every render defeats memo
const MemoizedList = React.memo(List);

function Parent() {
  return (
    <MemoizedList 
      style={{ color: 'red' }} // New object every render!
      onClick={() => handleClick()} // New function every render!
    />
  );
}

// ✅ CORRECT: Stable references
const style = { color: 'red' }; // Or useMemo if dynamic

function Parent() {
  const handleClick = useCallback(() => { /* ... */ }, []);
  
  return <MemoizedList style={style} onClick={handleClick} />;
}
```

## TypeScript Anti-Patterns

### 1. Using `any` Type

```typescript
// ❌ ANTI-PATTERN
const data: any = await response.json();
console.log(data.user.name); // No type safety

// ✅ CORRECT
interface ApiResponse {
  user: { name: string; email: string };
}
const data: ApiResponse = await response.json();
console.log(data.user.name); // Type safe
```

### 2. React.FC for Components

```typescript
// ❌ DISCOURAGED
const App: React.FC<AppProps> = ({ message }) => {
  return <div>{message}</div>;
};

// ✅ PREFERRED
const App = ({ message }: AppProps) => {
  return <div>{message}</div>;
};
```

**Why:** `React.FC` has issues with generics, defaultProps, and previously included implicit `children`.

### 3. Optional Props Creating Invalid States

```typescript
// ❌ ANTI-PATTERN: Can have value without onChange
interface InputProps {
  value?: string;
  onChange?: (value: string) => void;
}

// ✅ CORRECT: Discriminated union
type ControlledProps = { value: string; onChange: (v: string) => void };
type UncontrolledProps = { value?: never; onChange?: never; defaultValue?: string };
type InputProps = { label: string } & (ControlledProps | UncontrolledProps);
```

### 4. Array Access Without Undefined Check

```typescript
// ❌ ANTI-PATTERN (without noUncheckedIndexedAccess)
const arr: string[] = ['a', 'b'];
console.log(arr[10].toUpperCase()); // Runtime error!

// ✅ CORRECT
const item = arr[10];
if (item) {
  console.log(item.toUpperCase());
}
```

Enable `noUncheckedIndexedAccess: true` in tsconfig.

## Component Anti-Patterns

### 1. Component Defined Inside Another Component

```typescript
// ❌ ANTI-PATTERN: Inner remounts every render
function Parent() {
  function Child() { // New component identity each render!
    return <div>Child</div>;
  }
  return <Child />;
}

// ✅ CORRECT: Define outside
function Child() {
  return <div>Child</div>;
}

function Parent() {
  return <Child />;
}
```

### 2. Index as Key in Dynamic Lists

```typescript
// ❌ ANTI-PATTERN: State corruption on reorder
{items.map((item, index) => (
  <Item key={index} item={item} /> // BAD
))}

// ✅ CORRECT: Stable unique ID
{items.map(item => (
  <Item key={item.id} item={item} />
))}
```

### 3. God Components (Too Much Responsibility)

**Symptoms:**
- Component > 300 lines
- 10+ pieces of state
- Multiple unrelated concerns
- Difficult to test in isolation

**Solution:** Split by concern, extract custom hooks.

### 4. Prop Drilling > 3 Levels

```typescript
// ❌ ANTI-PATTERN
<GrandParent user={user}>
  <Parent user={user}>
    <Child user={user}>
      <GrandChild user={user} />
    </Child>
  </Parent>
</GrandParent>

// ✅ CORRECT: Context or composition
const UserContext = createContext<User | null>(null);

function GrandParent({ user }: { user: User }) {
  return (
    <UserContext value={user}>
      <Parent />
    </UserContext>
  );
}

// Or composition pattern
function GrandParent({ user }: { user: User }) {
  return (
    <Parent>
      <Child>
        <GrandChild user={user} />
      </Child>
    </Parent>
  );
}
```

## State Management Anti-Patterns

### 1. Copying Server State to Local State

```typescript
// ❌ ANTI-PATTERN: Creates stale data
const { data } = useQuery({ queryKey: ['todos'], queryFn: fetchTodos });
const [todos, setTodos] = useState<Todo[]>([]);

useEffect(() => {
  if (data) setTodos(data);
}, [data]);

// ✅ CORRECT: Query is the source of truth
const { data: todos } = useQuery({ queryKey: ['todos'], queryFn: fetchTodos });
```

### 2. Global State for Local Concerns

```typescript
// ❌ ANTI-PATTERN: Modal state in global store
const useStore = create((set) => ({
  isModalOpen: false,
  toggleModal: () => set((s) => ({ isModalOpen: !s.isModalOpen })),
}));

// ✅ CORRECT: Local state
function FeatureWithModal() {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button onClick={() => setIsOpen(true)}>Open</button>
      {isOpen && <Modal onClose={() => setIsOpen(false)} />}
    </>
  );
}
```

### 3. Zustand: Subscribing to Entire Store

```typescript
// ❌ ANTI-PATTERN: Re-renders on ANY store change
const { bears, fish } = useStore();

// ✅ CORRECT: Select only what you need
const bears = useStore((state) => state.bears);
const fish = useStore((state) => state.fish);
```

## File Structure Anti-Patterns

### Barrel Files in Application Code

```typescript
// ❌ ANTI-PATTERN: index.ts that re-exports everything
// src/components/index.ts
export * from './Button';
export * from './Input';
export * from './Modal';
// ... 50 more exports

// Importing one thing loads everything!
import { Button } from '@/components';

// ✅ CORRECT: Direct imports
import { Button } from '@/components/Button';
```

**Problems with barrel files:**
- Loads all exports even when importing one
- Circular dependency risks
- Tree-shaking breaks
- Slow dev server startup

**Exception:** Library public APIs where you control the entire export surface.