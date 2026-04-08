# React 19 Patterns Reference

## useActionState (Forms)

Replaces manual `isLoading`, `error`, `data` state management for form actions.

```typescript
import { useActionState } from 'react';

interface FormState {
  error: string | null;
  success: boolean;
}

async function createPost(prevState: FormState, formData: FormData): Promise<FormState> {
  const title = formData.get('title') as string;
  if (!title) return { error: 'Title required', success: false };
  
  await fetch('/api/posts', { method: 'POST', body: JSON.stringify({ title }) });
  return { error: null, success: true };
}

function NewPostForm() {
  const [state, formAction, isPending] = useActionState(createPost, {
    error: null,
    success: false,
  });

  return (
    <form action={formAction}>
      <input name="title" />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Submitting...' : 'Submit'}
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
```

**Review Points:**
- Action function must return consistent object shape
- Actions should be pure (return new state, not mutate)
- Check that error handling covers all failure cases

## useFormStatus (Submit Button State)

**Critical Rule:** Must be called in a child component of `<form>`, NOT in the same component.

```typescript
import { useFormStatus } from 'react-dom';

// ✅ CORRECT: Child component
function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending, data, method, action } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? 'Submitting...' : children}
    </button>
  );
}

function MyForm() {
  return (
    <form action={submitAction}>
      <input name="email" />
      <SubmitButton>Send</SubmitButton>
    </form>
  );
}

// ❌ WRONG: Same component as form - pending is always false!
function BadForm() {
  const { pending } = useFormStatus(); // BUG: Always false
  return (
    <form action={submitAction}>
      <button disabled={pending}>Submit</button>
    </form>
  );
}
```

## useOptimistic (Instant UI Updates)

Provides instant feedback before server confirms. Automatically reverts on error.

```typescript
import { useOptimistic, startTransition } from 'react';

interface Message {
  id: string;
  text: string;
  sending?: boolean;
}

function MessageThread({ messages }: { messages: Message[] }) {
  const [optimisticMessages, addOptimisticMessage] = useOptimistic(
    messages,
    (currentMessages, newText: string) => [
      { id: crypto.randomUUID(), text: newText, sending: true },
      ...currentMessages,
    ]
  );

  async function sendMessage(formData: FormData) {
    const text = formData.get('message') as string;
    addOptimisticMessage(text);
    
    startTransition(async () => {
      await deliverMessage(text);
    });
  }

  return (
    <div>
      {optimisticMessages.map(msg => (
        <div key={msg.id} style={{ opacity: msg.sending ? 0.5 : 1 }}>
          {msg.text}
        </div>
      ))}
      <form action={sendMessage}>
        <input name="message" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

**Review Points:**
- Optimistic state should be visually distinct (opacity, spinner)
- Consider what happens on error (automatic revert)
- Wrap async operations in `startTransition`

## use() API (Promise and Context Reading)

Unlike hooks, `use()` can be called conditionally. Major departure from traditional React rules.

### Reading Promises

```typescript
import { use, Suspense } from 'react';

// ✅ CORRECT: Promise passed from parent
function Comments({ commentsPromise }: { commentsPromise: Promise<Comment[]> }) {
  const comments = use(commentsPromise); // Suspends until resolved
  return <ul>{comments.map(c => <li key={c.id}>{c.text}</li>)}</ul>;
}

function Page() {
  const commentsPromise = fetchComments(); // Created once
  return (
    <Suspense fallback={<Spinner />}>
      <Comments commentsPromise={commentsPromise} />
    </Suspense>
  );
}

// ❌ WRONG: Promise created in render - INFINITE LOOP
function BadComponent() {
  const data = use(fetch('/api').then(r => r.json())); // New promise every render!
}
```

### Conditional Context Reading

```typescript
import { use, createContext } from 'react';

const ThemeContext = createContext<string>('light');

// ✅ use() can be called conditionally (useContext cannot!)
function HorizontalRule({ show }: { show: boolean }) {
  if (show) {
    const theme = use(ThemeContext);
    return <hr className={`hr-${theme}`} />;
  }
  return null;
}
```

**Review Points:**
- Always wrap `use(promise)` in `<Suspense>`
- Promise must come from props, state, or outside component
- Never create promise inline in render

## Server vs Client Components

| Server Components | Client Components |
|-------------------|-------------------|
| No directive needed | Must start with `'use client'` |
| Can access DB, filesystem | Can use useState, useEffect |
| Zero client JS | Ships JS to browser |
| Cannot use hooks | Full interactivity |

### Boundary Placement

Push `'use client'` as low as possible in the tree.

```typescript
// ✅ GOOD: Only interactive part is Client Component
// ProductPage.tsx (Server Component - no directive)
async function ProductPage({ id }: { id: string }) {
  const product = await db.query(`SELECT * FROM products WHERE id = $1`, [id]);
  
  return (
    <article>
      <h1>{product.name}</h1>           {/* Server: no JS */}
      <p>{product.description}</p>       {/* Server: no JS */}
      <AddToCartButton productId={id} /> {/* Client: needs onClick */}
    </article>
  );
}

// AddToCartButton.tsx
'use client';
function AddToCartButton({ productId }: { productId: string }) {
  const [adding, setAdding] = useState(false);
  // Client-side interactivity
}

// ❌ BAD: Entire page is client-side unnecessarily
'use client';
function ProductPage({ id }) {
  // Everything ships to client even though most is static
}
```

### Serialization Constraint

Props passed from Server to Client Components must be serializable.

**Cannot pass:**
- Functions (except Server Actions)
- Classes
- Symbols
- DOM nodes

```typescript
// ❌ WRONG: Function prop from Server to Client
async function ServerParent() {
  const handleClick = () => console.log('clicked'); // Not serializable!
  return <ClientChild onClick={handleClick} />;
}

// ✅ CORRECT: Use Server Action
async function ServerParent() {
  async function handleSubmit(formData: FormData) {
    'use server';
    // Server-side logic
  }
  return <ClientChild onSubmit={handleSubmit} />;
}
```

## ref as Prop (React 19)

No more `forwardRef` needed - ref can be passed as a regular prop.

```typescript
// React 18: Required forwardRef
const Input = forwardRef<HTMLInputElement, InputProps>((props, ref) => (
  <input ref={ref} {...props} />
));

// React 19: ref is just a prop
function Input({ ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}
```

## Context as Provider

`<Context>` can be used directly as provider (no `.Provider` needed).

```typescript
// React 18
<ThemeContext.Provider value={theme}>
  {children}
</ThemeContext.Provider>

// React 19
<ThemeContext value={theme}>
  {children}
</ThemeContext>
```

## Document Metadata in Components

Title and meta tags can be rendered anywhere in the tree.

```typescript
function BlogPost({ post }: { post: Post }) {
  return (
    <article>
      <title>{post.title}</title>
      <meta name="description" content={post.excerpt} />
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}
```

React 19 automatically hoists these to `<head>`.