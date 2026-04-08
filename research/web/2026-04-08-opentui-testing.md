---
source_url: https://github.com/anomalyco/opentui
fetched_at: 2026-04-08
fetch_method: github-api + raw-githubusercontent
topic: OpenTUI test renderer and testing utilities
---

# OpenTUI Testing Utilities

## Does OpenTUI provide a test renderer?

Yes. OpenTUI ships two testing entry points:

1. **`@opentui/core/testing`** — headless core renderer via `createTestRenderer()`
2. **`@opentui/react/test-utils`** — React-specific wrapper via `testRender()`

Both are confirmed by:
- Local skill: `.agents/skills/opentui/references/testing/REFERENCE.md`
- Live `package.json` exports in `anomalyco/opentui` (packages/react/package.json)
- Live source: `packages/react/src/test-utils.ts` and `packages/core/src/testing.ts`

---

## Import Paths

### For React components (preferred)

```ts
import { testRender } from "@opentui/react/test-utils"
```

Export map in `@opentui/react` `package.json`:
```json
"./test-utils": {
  "import": "./src/test-utils.ts",
  "types": "./src/test-utils.d.ts"
}
```

### For core (imperative) components

```ts
import { createTestRenderer } from "@opentui/core/testing"
```

`@opentui/core/testing` re-exports from:
- `testing/test-renderer.ts` — `createTestRenderer`, `TestRendererOptions`
- `testing/mock-keys.ts` — `createMockKeys`
- `testing/mock-mouse.ts` — `createMockMouse`
- `testing/test-recorder.ts` — `TestRecorder`, `RecordedFrame`

---

## `testRender` API (React)

```ts
async function testRender(
  node: ReactNode,
  testRendererOptions: TestRendererOptions  // { width, height, ... }
): Promise<TestSetup>
```

What `testRender` does internally:
1. Sets `globalThis.IS_REACT_ACT_ENVIRONMENT = true`
2. Calls `createTestRenderer(options)` from `@opentui/core/testing`
3. Creates a React root with `createRoot(testSetup.renderer)`
4. Wraps initial `root.render(node)` in `act()`
5. Wires up `onDestroy` to `act(() => root.unmount())`

### Returned `TestSetup` object

| Property | Type | Description |
|---|---|---|
| `renderer` | `TestRenderer` | Headless renderer — call `.destroy()` in `afterEach` |
| `renderOnce` | `() => Promise<void>` | Trigger one render loop cycle |
| `captureCharFrame` | `() => string` | Capture current output as plain text |
| `captureSpans` | `() => CapturedFrame` | Capture structured span lines with cursor state |
| `mockInput` | `MockInput` | Key-press simulation helpers |
| `mockMouse` | `MockMouse` | Mouse event simulation helpers |
| `resize` | `(w, h) => void` | Resize the virtual terminal |

---

## Usage Patterns

### Minimal React component test

```tsx
import { test, expect } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

function Greeting({ name }: { name: string }) {
  return <text>Hello, {name}!</text>
}

test("Greeting renders name", async () => {
  const testSetup = await testRender(
    <Greeting name="World" />,
    { width: 80, height: 24 }
  )
  await testSetup.renderOnce()
  expect(testSetup.captureCharFrame()).toContain("Hello, World!")
  testSetup.renderer.destroy()
})
```

### Snapshot test with lifecycle management

```tsx
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { testRender } from "@opentui/react/test-utils"

let testSetup: Awaited<ReturnType<typeof testRender>>

describe("MyComponent", () => {
  beforeEach(async () => {
    if (testSetup) testSetup.renderer.destroy()
  })
  afterEach(() => {
    if (testSetup) testSetup.renderer.destroy()
  })

  test("matches snapshot", async () => {
    testSetup = await testRender(<MyComponent />, { width: 40, height: 10 })
    await testSetup.renderOnce()
    expect(testSetup.captureCharFrame()).toMatchSnapshot()
  })
})
```

### Real-world example from OpenTUI repo (`packages/react/tests/layout.test.tsx`)

```tsx
import { testRender } from "../src/test-utils.js"

describe("React Renderer | Layout Tests", () => {
  it("should render simple text correctly", async () => {
    testSetup = await testRender(<text>Hello World</text>, { width: 20, height: 5 })
    await testSetup.renderOnce()
    const frame = testSetup.captureCharFrame()
    expect(frame).toMatchSnapshot()
  })
})
```

---

## Key Gotchas

1. Always call `await testSetup.renderOnce()` before `captureCharFrame()` — rendering is async.
2. Always call `testSetup.renderer.destroy()` in `afterEach` to avoid resource leaks.
3. Use consistent `width`/`height` in snapshot tests for stable results.
4. Run snapshots with `bun test --update-snapshots` when layouts change intentionally.
5. The live docs at https://opentui.com/docs have no dedicated Testing page — the skill file is the authoritative reference.

---

## Sources

- Local skill: `/home/alexlavaee/Documents/projects/atomic/.agents/skills/opentui/references/testing/REFERENCE.md`
- Source: https://github.com/anomalyco/opentui/blob/main/packages/react/src/test-utils.ts
- Source: https://github.com/anomalyco/opentui/blob/main/packages/core/src/testing.ts
- Source: https://github.com/anomalyco/opentui/blob/main/packages/react/tests/layout.test.tsx
- Source: https://github.com/anomalyco/opentui/blob/main/packages/react/package.json
