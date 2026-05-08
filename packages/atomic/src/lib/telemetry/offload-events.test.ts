import { test, expect } from "bun:test";
import {
  WORKFLOW_OFFLOAD_SCHEDULED,
  WORKFLOW_OFFLOAD_COMPLETED,
  WORKFLOW_OFFLOAD_RESUME_ATTEMPTED,
  WORKFLOW_OFFLOAD_RESUME_SUCCEEDED,
  WORKFLOW_OFFLOAD_RESUME_FAILED,
  WORKFLOW_OFFLOAD_RESUME_LATENCY_MS,
  WORKFLOW_OFFLOAD_RESUME_ROLLBACK_FAILED,
  WORKFLOW_OFFLOAD_REGISTER_PERSISTED,
  WORKFLOW_OFFLOAD_CLAUDE_MARKER_CLEANUP,
} from "./offload-events.ts";

test("WORKFLOW_OFFLOAD_SCHEDULED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_SCHEDULED).toBe("workflow.offload.scheduled");
});

test("WORKFLOW_OFFLOAD_COMPLETED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_COMPLETED).toBe("workflow.offload.completed");
});

test("WORKFLOW_OFFLOAD_RESUME_ATTEMPTED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_RESUME_ATTEMPTED).toBe("workflow.offload.resume.attempted");
});

test("WORKFLOW_OFFLOAD_RESUME_SUCCEEDED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_RESUME_SUCCEEDED).toBe("workflow.offload.resume.succeeded");
});

test("WORKFLOW_OFFLOAD_RESUME_FAILED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_RESUME_FAILED).toBe("workflow.offload.resume.failed");
});

test("WORKFLOW_OFFLOAD_RESUME_LATENCY_MS equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_RESUME_LATENCY_MS).toBe("workflow.offload.resume.latency_ms");
});

test("WORKFLOW_OFFLOAD_RESUME_ROLLBACK_FAILED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_RESUME_ROLLBACK_FAILED).toBe(
    "workflow.offload.resume.rollback_failed",
  );
});

test("WORKFLOW_OFFLOAD_REGISTER_PERSISTED equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_REGISTER_PERSISTED).toBe(
    "workflow.offload.register.persisted",
  );
});

test("WORKFLOW_OFFLOAD_CLAUDE_MARKER_CLEANUP equals spec string", () => {
  expect(WORKFLOW_OFFLOAD_CLAUDE_MARKER_CLEANUP).toBe(
    "workflow.offload.claude_marker_cleanup",
  );
});
