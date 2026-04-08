/** @jsxImportSource @opentui/react */

import { test, expect, describe, afterEach, mock } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { ErrorBoundary } from "../../../packages/workflow-sdk/src/components/error-boundary.tsx";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  testSetup?.renderer.destroy();
  testSetup = null;
});

function ThrowingChild({ message }: { message: string }): never {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  test("renders children when no error is thrown", async () => {
    testSetup = await testRender(
      <ErrorBoundary fallback={() => <text>fallback</text>}>
        <text>safe content</text>
      </ErrorBoundary>,
      { width: 40, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("safe content");
    expect(frame).not.toContain("fallback");
  });

  test("renders fallback when a child throws during render", async () => {
    // Suppress console.error from componentDidCatch during test
    const originalError = console.error;
    console.error = mock(() => {});

    testSetup = await testRender(
      <ErrorBoundary
        fallback={(err) => <text>{`caught: ${err.message}`}</text>}
      >
        <ThrowingChild message="render boom" />
      </ErrorBoundary>,
      { width: 60, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("caught: render boom");

    console.error = originalError;
  });

  test("componentDidCatch logs the error to stderr", async () => {
    const calls: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { calls.push(args); };

    testSetup = await testRender(
      <ErrorBoundary fallback={() => <text>fallback</text>}>
        <ThrowingChild message="log test" />
      </ErrorBoundary>,
      { width: 40, height: 10 },
    );
    await testSetup.renderOnce();

    expect(calls.length).toBeGreaterThan(0);
    // Find the call from our ErrorBoundary (React may also log errors)
    const boundaryCall = calls.find((c) => c[0] === "[ErrorBoundary]");
    expect(boundaryCall).toBeDefined();

    console.error = originalError;
  });

  test("getDerivedStateFromError captures the Error object", async () => {
    const originalError = console.error;
    console.error = mock(() => {});

    testSetup = await testRender(
      <ErrorBoundary
        fallback={(err) => <text>{err.constructor.name}</text>}
      >
        <ThrowingChild message="type check" />
      </ErrorBoundary>,
      { width: 40, height: 10 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain("Error");

    console.error = originalError;
  });
});
