import { test, expect } from "bun:test";
import { checkAwaitOrCatch, checkSwitchClientGate } from "./lint-offload-await.ts";

// ── checkAwaitOrCatch ─────────────────────────────────────────────────────────

test("checkAwaitOrCatch flags bare requestResume", () => {
  const lines = ['offloadManager.requestResume("foo")'];
  const v = checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await");
  expect(v).toHaveLength(1);
  expect(v[0]!.rule).toBe("requestResume-await");
  expect(v[0]!.line).toBe(1);
});

test("checkAwaitOrCatch flags bare registerSession", () => {
  const lines = ['offloadManager.registerSession("foo", {})'];
  const v = checkAwaitOrCatch("x.ts", lines, "offloadManager.registerSession(", "registerSession-await");
  expect(v).toHaveLength(1);
});

test("checkAwaitOrCatch allows await", () => {
  const lines = ['await offloadManager.requestResume("foo")'];
  expect(
    checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await"),
  ).toHaveLength(0);
});

test("checkAwaitOrCatch allows void prefix", () => {
  const lines = ['void offloadManager.requestResume("foo")'];
  expect(
    checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await"),
  ).toHaveLength(0);
});

test("checkAwaitOrCatch allows comment line", () => {
  const lines = ['// offloadManager.requestResume("foo") — not called yet'];
  expect(
    checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await"),
  ).toHaveLength(0);
});

test("checkAwaitOrCatch allows .catch within window", () => {
  const lines = [
    'offloadManager.requestResume("foo")',
    "  .then(() => 1)",
    "  .catch(() => 2);",
  ];
  expect(
    checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await"),
  ).toHaveLength(0);
});

test("checkAwaitOrCatch flags when .catch is beyond 5-line window", () => {
  const lines = [
    'offloadManager.requestResume("foo")',
    "  .then(() => 1)",
    "  .then(() => 2)",
    "  .then(() => 3)",
    "  .then(() => 4)",
    "  .then(() => 5)",
    "  .catch(() => 6);",
  ];
  const v = checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await");
  expect(v).toHaveLength(1);
});

test("checkAwaitOrCatch handles multiple violations across lines", () => {
  const lines = [
    'offloadManager.requestResume("a")',
    "// some comment",
    'offloadManager.requestResume("b")',
  ];
  const v = checkAwaitOrCatch("x.ts", lines, "offloadManager.requestResume(", "requestResume-await");
  expect(v).toHaveLength(2);
  expect(v[0]!.line).toBe(1);
  expect(v[1]!.line).toBe(3);
});

// ── checkSwitchClientGate ─────────────────────────────────────────────────────

test("checkSwitchClientGate flags bare switch-client", () => {
  const lines = ['tmuxRun(["switch-client", "-t", "foo:bar"])'];
  expect(checkSwitchClientGate("x.tsx", lines)).toHaveLength(1);
});

test("checkSwitchClientGate allows offload-exempt annotation on same line", () => {
  const lines = [
    'tmuxRun(["switch-client", "-t", "foo:bar"]); // offload-exempt: orchestrator window 0',
  ];
  expect(checkSwitchClientGate("x.tsx", lines)).toHaveLength(0);
});

test("checkSwitchClientGate allows offload-exempt annotation on previous line", () => {
  const lines = [
    "// offload-exempt: status checked above",
    'tmuxRun(["switch-client", "-t", "foo:bar"]);',
  ];
  expect(checkSwitchClientGate("x.tsx", lines)).toHaveLength(0);
});

test("checkSwitchClientGate allows preceding getStatus check", () => {
  const lines = [
    "const status = offloadManager.getStatus(id);",
    'if (status === "alive") {',
    '  tmuxRun(["switch-client", "-t", "foo:bar"]);',
    "}",
  ];
  expect(checkSwitchClientGate("x.tsx", lines)).toHaveLength(0);
});

test("checkSwitchClientGate allows preceding requestResume check", () => {
  const lines = [
    "await offloadManager.requestResume(id);",
    'tmuxRun(["switch-client", "-t", "foo:bar"]);',
  ];
  expect(checkSwitchClientGate("x.tsx", lines)).toHaveLength(0);
});

test("checkSwitchClientGate flags when gate is beyond 20-line window", () => {
  const lines: string[] = ["offloadManager.getStatus(id);"];
  for (let i = 0; i < 20; i++) lines.push(`const x${i} = ${i};`);
  lines.push('tmuxRun(["switch-client", "-t", "foo:bar"]);');
  expect(checkSwitchClientGate("x.tsx", lines)).toHaveLength(1);
});

test("checkSwitchClientGate returns violation with correct metadata", () => {
  const lines = ['  tmuxRun(["switch-client", "-t", "foo:bar"]);'];
  const v = checkSwitchClientGate("my-file.tsx", lines);
  expect(v).toHaveLength(1);
  expect(v[0]!.file).toBe("my-file.tsx");
  expect(v[0]!.line).toBe(1);
  expect(v[0]!.rule).toBe("switch-client-gate");
  expect(v[0]!.text).toBe('tmuxRun(["switch-client", "-t", "foo:bar"]);');
});
