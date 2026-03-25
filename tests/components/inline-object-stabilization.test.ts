/**
 * Structural tests verifying inline objects have been stabilized with
 * module-level constants or useMemo to prevent unnecessary re-renders.
 *
 * Addresses anti-pattern §5.5.3 from opentui-react-antipattern-audit.md.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const SRC = path.resolve(import.meta.dir, "../../src");

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(SRC, relativePath), "utf-8");
}

// ============================================================================
// ChatShell.tsx — scrollbar options extracted to module-level constants
// ============================================================================

describe("ChatShell.tsx inline object stabilization", () => {
  const content = readFile("state/chat/shell/ChatShell.tsx");

  it("has HIDDEN_VERTICAL_SCROLLBAR as a module-level constant", () => {
    const constIdx = content.indexOf("const HIDDEN_VERTICAL_SCROLLBAR");
    expect(constIdx).toBeGreaterThan(-1);

    // Should be before the component function (module-level)
    const componentIdx = content.indexOf("export function ChatShell");
    expect(constIdx).toBeLessThan(componentIdx);

    // Should use `as const` for type narrowing
    const constLine = content.slice(constIdx, content.indexOf("\n", constIdx));
    expect(constLine).toContain("as const");
    expect(constLine).toContain("visible: false");
  });

  it("has HIDDEN_HORIZONTAL_SCROLLBAR as a module-level constant", () => {
    const constIdx = content.indexOf("const HIDDEN_HORIZONTAL_SCROLLBAR");
    expect(constIdx).toBeGreaterThan(-1);

    const componentIdx = content.indexOf("export function ChatShell");
    expect(constIdx).toBeLessThan(componentIdx);

    const constLine = content.slice(constIdx, content.indexOf("\n", constIdx));
    expect(constLine).toContain("as const");
    expect(constLine).toContain("visible: false");
  });

  it("uses constant references instead of inline objects for scrollbar options", () => {
    // The JSX area should reference the constants, not inline objects
    const returnIdx = content.indexOf("return (");
    expect(returnIdx).toBeGreaterThan(-1);

    const jsxArea = content.slice(returnIdx);
    expect(jsxArea).toContain("verticalScrollbarOptions={HIDDEN_VERTICAL_SCROLLBAR}");
    expect(jsxArea).toContain("horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}");
  });

  it("does NOT use inline { visible: false } in JSX scrollbar props", () => {
    const returnIdx = content.indexOf("return (");
    expect(returnIdx).toBeGreaterThan(-1);

    const jsxArea = content.slice(returnIdx);
    // Anti-pattern: inline object literal in scrollbar options
    expect(jsxArea).not.toContain("verticalScrollbarOptions={{ visible: false }}");
    expect(jsxArea).not.toContain("horizontalScrollbarOptions={{ visible: false }}");
  });
});

// ============================================================================
// transcript-view.tsx — scrollbar options extracted to module-level constants
// ============================================================================

describe("transcript-view.tsx inline object stabilization", () => {
  const content = readFile("components/transcript-view.tsx");

  it("has HIDDEN_VERTICAL_SCROLLBAR as a module-level constant", () => {
    const constIdx = content.indexOf("const HIDDEN_VERTICAL_SCROLLBAR");
    expect(constIdx).toBeGreaterThan(-1);

    const componentIdx = content.indexOf("export function TranscriptView");
    expect(constIdx).toBeLessThan(componentIdx);

    const constLine = content.slice(constIdx, content.indexOf("\n", constIdx));
    expect(constLine).toContain("as const");
    expect(constLine).toContain("visible: false");
  });

  it("has HIDDEN_HORIZONTAL_SCROLLBAR as a module-level constant", () => {
    const constIdx = content.indexOf("const HIDDEN_HORIZONTAL_SCROLLBAR");
    expect(constIdx).toBeGreaterThan(-1);

    const componentIdx = content.indexOf("export function TranscriptView");
    expect(constIdx).toBeLessThan(componentIdx);

    const constLine = content.slice(constIdx, content.indexOf("\n", constIdx));
    expect(constLine).toContain("as const");
    expect(constLine).toContain("visible: false");
  });

  it("uses constant references instead of inline objects for scrollbar options", () => {
    const returnIdx = content.indexOf("return (");
    expect(returnIdx).toBeGreaterThan(-1);

    const jsxArea = content.slice(returnIdx);
    expect(jsxArea).toContain("verticalScrollbarOptions={HIDDEN_VERTICAL_SCROLLBAR}");
    expect(jsxArea).toContain("horizontalScrollbarOptions={HIDDEN_HORIZONTAL_SCROLLBAR}");
  });

  it("does NOT use inline { visible: false } in JSX scrollbar props", () => {
    const returnIdx = content.indexOf("return (");
    expect(returnIdx).toBeGreaterThan(-1);

    const jsxArea = content.slice(returnIdx);
    expect(jsxArea).not.toContain("verticalScrollbarOptions={{ visible: false }}");
    expect(jsxArea).not.toContain("horizontalScrollbarOptions={{ visible: false }}");
  });
});

// ============================================================================
// chat-screen.tsx — app object wrapped in useMemo
// ============================================================================

describe("chat-screen.tsx inline object stabilization", () => {
  const content = readFile("screens/chat-screen.tsx");

  it("imports useMemo from react", () => {
    expect(content).toMatch(/import\s+React,\s*\{[^}]*useMemo[^}]*\}\s+from\s+"react"/);
  });

  it("wraps app object in useMemo", () => {
    // Find the useMemo call that creates the app object
    const useMemoIdx = content.indexOf("const app = useMemo(");
    expect(useMemoIdx).toBeGreaterThan(-1);

    // Verify it's before the useChatUiControllerStack call
    const controllerIdx = content.indexOf("useChatUiControllerStack(");
    expect(useMemoIdx).toBeLessThan(controllerIdx);
  });

  it("useMemo for app includes a dependency array", () => {
    const useMemoIdx = content.indexOf("const app = useMemo(");
    expect(useMemoIdx).toBeGreaterThan(-1);

    // Extract the full useMemo call (find the matching closing paren with deps)
    const afterMemo = content.slice(useMemoIdx, useMemoIdx + 2000);
    // Should have a dependency array: }), [dep1, dep2, ...]);
    expect(afterMemo).toMatch(/\}\),\s*\[[\s\S]*?\]\s*\)/);
  });

  it("useMemo dependency array includes all app properties", () => {
    const useMemoIdx = content.indexOf("const app = useMemo(");
    expect(useMemoIdx).toBeGreaterThan(-1);

    const afterMemo = content.slice(useMemoIdx, useMemoIdx + 2000);

    // Extract the dependency array
    const depsMatch = afterMemo.match(/\}\),\s*\[([\s\S]*?)\]\s*\)/);
    expect(depsMatch).not.toBeNull();

    const depsContent = depsMatch![1];

    // All properties from the app object should be in the dependency array
    const expectedDeps = [
      "createSubagentSession",
      "streamWithSession",
      "ensureSession",
      "getModelDisplayInfo",
      "getSession",
      "initialModelId",
      "initialPrompt",
      "model",
      "modelOps",
      "onCommandExecutionTelemetry",
      "onExit",
      "onInterrupt",
      "onModelChange",
      "onResetSession",
      "onSendMessage",
      "onSessionMcpServersChange",
      "onTerminateBackgroundAgents",
      "setStreamingState",
      "tier",
      "version",
      "workingDir",
    ];

    for (const dep of expectedDeps) {
      expect(depsContent).toContain(dep);
    }
  });

  it("does NOT pass inline app object to useChatUiControllerStack", () => {
    const controllerIdx = content.indexOf("useChatUiControllerStack(");
    expect(controllerIdx).toBeGreaterThan(-1);

    const afterController = content.slice(controllerIdx, controllerIdx + 200);
    // Should use the memoized variable, not inline object
    expect(afterController).toContain("app,");
    expect(afterController).not.toContain("app: {");
  });
});
