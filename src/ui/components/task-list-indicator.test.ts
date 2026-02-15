import { describe, expect, test } from "bun:test";
import {
  TASK_STATUS_ICONS,
  getRenderableTaskStatus,
  getStatusColorKey,
  type TaskItem,
} from "./task-list-indicator.tsx";

describe("TaskListIndicator status safety", () => {
  test("normalizes unknown statuses to pending for rendering", () => {
    const status = getRenderableTaskStatus("not-a-real-status");
    expect(status).toBe("pending");
    expect(getStatusColorKey(status)).toBe("muted");
    expect(TASK_STATUS_ICONS[status]).toBeDefined();
  });

  test("normalizes status aliases used by external task writers", () => {
    expect(getRenderableTaskStatus("in-progress")).toBe("in_progress");
    expect(getRenderableTaskStatus("Done")).toBe("completed");
  });

  test("returns muted color key as a runtime fallback", () => {
    const runtimeStatus = "unknown" as unknown as TaskItem["status"];
    expect(getStatusColorKey(runtimeStatus)).toBe("muted");
  });
});
