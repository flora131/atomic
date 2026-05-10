/**
 * Tests for claudeInflightHookCommand and its helpers.
 *
 * Strategy: monkey-patch `Bun.stdin.text` to feed payloads to the handler
 * directly, then assert against real filesystem state. No mocks of fs or of
 * the hook internals — the contract is "marker files appear/disappear
 * correctly under the per-root inflight dir," and we verify exactly that.
 *
 * Each test uses `crypto.randomUUID()` for unique session/agent ids and
 * cleans up in `afterEach` so runs never collide with each other or with
 * real workflow runs that share `~/.atomic/claude-inflight/`.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { access, mkdir, rm, stat, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import {
  claudeInflightHookCommand,
  inflightDirIsEmpty,
  sweepStaleInflight,
  waitForInflightDrained,
  clearInflightTracking,
} from "@bastani/atomic-sdk/providers/claude-inflight-hook";
import { claudeHookDirs, claudeStopHookCommand } from "@bastani/atomic-sdk/providers/claude-stop-hook";

const dirs = claudeHookDirs();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function mockStdin(text: string): void {
  (Bun.stdin as { text: () => Promise<string> }).text = () =>
    Promise.resolve(text);
}

const sessionsToClean: string[] = [];

afterEach(async () => {
  for (const id of sessionsToClean) {
    await Promise.all([
      rm(join(dirs.inflight, id), { recursive: true, force: true }),
      rm(join(dirs.inflightRoots, id), { force: true }),
      rm(join(dirs.marker, id), { force: true }),
      rm(join(dirs.queue, id), { force: true }),
      rm(join(dirs.release, id), { force: true }),
      rm(join(dirs.pid, id), { force: true }),
    ]);
  }
  sessionsToClean.length = 0;
});

describe("claudeInflightHookCommand — start mode", () => {
  test("SubagentStart writes a marker file under <inflight>/<session>/<agent_id>", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "SubagentStart",
      agent_id: agentId,
      agent_type: "general-purpose",
    }));

    const code = await claudeInflightHookCommand("start");

    expect(code).toBe(0);
    expect(await fileExists(join(dirs.inflight, sessionId, agentId))).toBe(true);
  });

  test("marker payload captures parent_session_id, root, and a numeric ts", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "SubagentStart",
      agent_id: agentId,
    }));

    await claudeInflightHookCommand("start");

    const body = await Bun.file(join(dirs.inflight, sessionId, agentId)).text();
    const parsed = JSON.parse(body) as Record<string, unknown>;

    expect(parsed["parent_session_id"]).toBe(sessionId);
    expect(parsed["root"]).toBe(sessionId);
    expect(parsed["kind"]).toBe("SubagentStart");
    expect(typeof parsed["ts"]).toBe("number");
  });

  test("nested SubagentStart resolves to the original root via .session-roots mapping", async () => {
    const rootSession = crypto.randomUUID();
    const childAgent = crypto.randomUUID();
    const grandchildAgent = crypto.randomUUID();
    sessionsToClean.push(rootSession, childAgent, grandchildAgent);

    // Direct child: SubagentStart fires under root's session.
    mockStdin(JSON.stringify({
      session_id: rootSession,
      hook_event_name: "SubagentStart",
      agent_id: childAgent,
    }));
    await claudeInflightHookCommand("start");

    // Grandchild: SubagentStart fires under the child's session_id (the
    // child is itself a Claude session). The handler must resolve the root
    // via the .session-roots mapping written for childAgent above.
    mockStdin(JSON.stringify({
      session_id: childAgent,
      hook_event_name: "SubagentStart",
      agent_id: grandchildAgent,
    }));
    await claudeInflightHookCommand("start");

    // Both markers should land under <inflight>/<rootSession>/.
    expect(await fileExists(join(dirs.inflight, rootSession, childAgent))).toBe(true);
    expect(await fileExists(join(dirs.inflight, rootSession, grandchildAgent))).toBe(true);
    // Grandchild must NOT also be under <inflight>/<childAgent>/ — that
    // would mean the wait-for-drain on rootSession could empty out before
    // the grandchild finishes.
    expect(await fileExists(join(dirs.inflight, childAgent, grandchildAgent))).toBe(false);
  });

  test("payload missing agent_id is a no-op", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    mockStdin(JSON.stringify({ session_id: sessionId, hook_event_name: "SubagentStart" }));

    const code = await claudeInflightHookCommand("start");

    expect(code).toBe(0);
    // No marker dir should have been created.
    expect(await fileExists(join(dirs.inflight, sessionId))).toBe(false);
  });

  test("malformed JSON is a no-op and returns 0", async () => {
    mockStdin("not json {");
    const code = await claudeInflightHookCommand("start");
    expect(code).toBe(0);
  });

  test("missing session_id is a no-op and returns 0", async () => {
    mockStdin(JSON.stringify({ agent_id: "orphan" }));
    const code = await claudeInflightHookCommand("start");
    expect(code).toBe(0);
  });
});

describe("claudeInflightHookCommand — stop mode", () => {
  test("SubagentStop removes the marker for the given agent_id", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    // Seed via start.
    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "SubagentStart",
      agent_id: agentId,
    }));
    await claudeInflightHookCommand("start");
    expect(await fileExists(join(dirs.inflight, sessionId, agentId))).toBe(true);

    // Stop should remove it.
    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "SubagentStop",
      agent_id: agentId,
    }));
    const code = await claudeInflightHookCommand("stop");

    expect(code).toBe(0);
    expect(await fileExists(join(dirs.inflight, sessionId, agentId))).toBe(false);
  });

  test("stop on an unknown id is a no-op and returns 0", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    mockStdin(JSON.stringify({
      session_id: sessionId,
      hook_event_name: "SubagentStop",
      agent_id: agentId,
    }));
    const code = await claudeInflightHookCommand("stop");

    expect(code).toBe(0);
  });

  test("stop resolves the same root as start for nested subagents", async () => {
    const rootSession = crypto.randomUUID();
    const childAgent = crypto.randomUUID();
    const grandchildAgent = crypto.randomUUID();
    sessionsToClean.push(rootSession, childAgent, grandchildAgent);

    // Start child + grandchild.
    mockStdin(JSON.stringify({ session_id: rootSession, agent_id: childAgent }));
    await claudeInflightHookCommand("start");
    mockStdin(JSON.stringify({ session_id: childAgent, agent_id: grandchildAgent }));
    await claudeInflightHookCommand("start");

    // Stop the grandchild — its `session_id` field is the child's session,
    // but the marker lives under root. The handler must resolve correctly.
    mockStdin(JSON.stringify({ session_id: childAgent, agent_id: grandchildAgent }));
    await claudeInflightHookCommand("stop");

    expect(await fileExists(join(dirs.inflight, rootSession, grandchildAgent))).toBe(false);
    expect(await fileExists(join(dirs.inflight, rootSession, childAgent))).toBe(true);
  });
});

describe("claudeInflightHookCommand — wait mode (TeammateIdle)", () => {
  test("returns 0 immediately when the in-flight dir is empty", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    mockStdin(JSON.stringify({ session_id: sessionId, hook_event_name: "TeammateIdle" }));

    const start = Date.now();
    const code = await claudeInflightHookCommand("wait");
    const elapsed = Date.now() - start;

    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(100);
  });

  test("waits for the in-flight dir to drain before returning", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    // Seed an in-flight subagent on this root.
    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");

    // Drain after 80 ms.
    setTimeout(() => {
      void rm(join(dirs.inflight, sessionId, agentId), { force: true });
    }, 80);

    mockStdin(JSON.stringify({ session_id: sessionId, hook_event_name: "TeammateIdle" }));

    const start = Date.now();
    const code = await claudeInflightHookCommand("wait");
    const elapsed = Date.now() - start;

    expect(code).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(2_000);
  });

  test("malformed JSON is a no-op and returns 0", async () => {
    mockStdin("not json {");
    const code = await claudeInflightHookCommand("wait");
    expect(code).toBe(0);
  });

  test("resolves the root via .session-roots when the event fires under a teammate's session", async () => {
    const rootSession = crypto.randomUUID();
    const teammateSession = crypto.randomUUID();
    const grandchildAgent = crypto.randomUUID();
    sessionsToClean.push(rootSession, teammateSession, grandchildAgent);

    // Set up: rootSession spawned teammateSession (which writes a roots-mapping
    // entry pointing at rootSession), then teammateSession spawned grandchildAgent.
    mockStdin(JSON.stringify({ session_id: rootSession, agent_id: teammateSession }));
    await claudeInflightHookCommand("start");
    mockStdin(JSON.stringify({ session_id: teammateSession, agent_id: grandchildAgent }));
    await claudeInflightHookCommand("start");

    // TeammateIdle fires under teammateSession's session_id. The wait must
    // resolve the root and gate on rootSession's in-flight dir.
    mockStdin(JSON.stringify({ session_id: teammateSession, hook_event_name: "TeammateIdle" }));

    // Drain the root's markers after 80 ms.
    setTimeout(() => {
      void rm(join(dirs.inflight, rootSession), { recursive: true, force: true });
    }, 80);

    const start = Date.now();
    const code = await claudeInflightHookCommand("wait");
    const elapsed = Date.now() - start;

    expect(code).toBe(0);
    expect(elapsed).toBeGreaterThanOrEqual(80);
    expect(elapsed).toBeLessThan(2_000);
  });
});

describe("inflightDirIsEmpty", () => {
  test("returns true when the dir is missing", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);
    expect(await inflightDirIsEmpty(sessionId)).toBe(true);
  });

  test("returns false when the dir contains a marker", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    mockStdin(JSON.stringify({
      session_id: sessionId,
      agent_id: crypto.randomUUID(),
    }));
    await claudeInflightHookCommand("start");

    expect(await inflightDirIsEmpty(sessionId)).toBe(false);
  });

  test("returns true when the dir exists but is empty", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);
    await mkdir(join(dirs.inflight, sessionId), { recursive: true });
    expect(await inflightDirIsEmpty(sessionId)).toBe(true);
  });
});

describe("sweepStaleInflight", () => {
  test("removes markers older than threshold and leaves fresh ones alone", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    const dir = join(dirs.inflight, sessionId);
    await mkdir(dir, { recursive: true });
    const stale = join(dir, "stale");
    const fresh = join(dir, "fresh");
    await writeFile(stale, "stale");
    await writeFile(fresh, "fresh");
    // Backdate the stale marker to 3 hours ago.
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await utimes(stale, threeHoursAgo, threeHoursAgo);

    const reaped = await sweepStaleInflight(sessionId);

    expect(reaped).toBe(1);
    expect(await fileExists(stale)).toBe(false);
    expect(await fileExists(fresh)).toBe(true);
  });

  test("returns 0 when the dir is missing", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);
    expect(await sweepStaleInflight(sessionId)).toBe(0);
  });

  test("custom threshold is honored", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);
    const dir = join(dirs.inflight, sessionId);
    await mkdir(dir, { recursive: true });
    const marker = join(dir, "id");
    await writeFile(marker, "x");
    // Backdate 200 ms.
    const past = new Date(Date.now() - 200);
    await utimes(marker, past, past);

    // Threshold of 50 ms → should sweep.
    const reaped = await sweepStaleInflight(sessionId, 50);
    expect(reaped).toBe(1);
  });
});

describe("waitForInflightDrained", () => {
  test("resolves immediately when the dir is empty/missing", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    const start = Date.now();
    await waitForInflightDrained(sessionId, { timeoutMs: 500, pollIntervalMs: 50 });
    const elapsed = Date.now() - start;

    // Should be effectively instant (well under one poll interval).
    expect(elapsed).toBeLessThan(100);
  });

  test("resolves once the marker is removed externally", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");

    // Capture `start` before scheduling setTimeout — otherwise schedule-to-fire
    // skew can shave a ms off `elapsed` and flake the `>= 80` assert.
    const start = Date.now();
    setTimeout(() => {
      void rm(join(dirs.inflight, sessionId, agentId), { force: true });
    }, 80);

    await waitForInflightDrained(sessionId, {
      timeoutMs: 2_000,
      pollIntervalMs: 25,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(75);
    expect(elapsed).toBeLessThan(1_000);
  });

  test("resolves on timeout even when the marker never drains", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");

    const start = Date.now();
    await waitForInflightDrained(sessionId, {
      timeoutMs: 200,
      pollIntervalMs: 25,
      // Extremely high stale threshold so the sweep doesn't reap our marker.
      staleMs: 24 * 60 * 60 * 1000,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(200);
    expect(elapsed).toBeLessThan(800);
    // Marker is still on disk — the wait gave up, didn't reap.
    expect(await fileExists(join(dirs.inflight, sessionId, agentId))).toBe(true);
  });

  test("uses the in-loop stale sweep to recover from a wedged marker", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    // Seed a marker and immediately backdate it past the staleMs threshold.
    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");
    const path = join(dirs.inflight, sessionId, agentId);
    const past = new Date(Date.now() - 60_000);
    await utimes(path, past, past);

    // staleMs = 30s → the marker is stale → first sweep tick reaps it.
    const start = Date.now();
    await waitForInflightDrained(sessionId, {
      timeoutMs: 5_000,
      pollIntervalMs: 25,
      staleMs: 30_000,
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(await fileExists(path)).toBe(false);
  });
});

describe("clearInflightTracking", () => {
  test("removes the marker dir and any roots-mapping entries pointing at it", async () => {
    const rootSession = crypto.randomUUID();
    const childAgent = crypto.randomUUID();
    sessionsToClean.push(rootSession, childAgent);

    mockStdin(JSON.stringify({ session_id: rootSession, agent_id: childAgent }));
    await claudeInflightHookCommand("start");

    expect(await fileExists(join(dirs.inflight, rootSession, childAgent))).toBe(true);
    expect(await fileExists(join(dirs.inflightRoots, childAgent))).toBe(true);

    await clearInflightTracking(rootSession);

    expect(await fileExists(join(dirs.inflight, rootSession))).toBe(false);
    expect(await fileExists(join(dirs.inflightRoots, childAgent))).toBe(false);
  });

  test("is idempotent / safe when nothing exists yet", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);
    // Should not throw.
    await clearInflightTracking(sessionId);
  });
});

describe("Stop hook gates release on inflight drain", () => {
  test("with markers present, the Stop hook does NOT consume the release marker", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    // Seed an in-flight subagent for this session.
    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");

    // Pre-write the release marker so the Stop hook would normally consume
    // it on the first poll tick.
    await mkdir(dirs.release, { recursive: true });
    await writeFile(join(dirs.release, sessionId), "");

    // Run the Stop hook with a short timeout so we don't actually wait 24 days.
    mockStdin(JSON.stringify({ session_id: sessionId }));
    const code = await claudeStopHookCommand({
      waitTimeoutMs: 250,
      pollIntervalMs: 25,
    });

    // Hook exits 0 (timeout path), but crucially the release marker was NOT
    // consumed because inflight was non-empty.
    expect(code).toBe(0);
    expect(await fileExists(join(dirs.release, sessionId))).toBe(true);
  });

  test("with no markers, the Stop hook consumes the release marker promptly", async () => {
    const sessionId = crypto.randomUUID();
    sessionsToClean.push(sessionId);

    await mkdir(dirs.release, { recursive: true });
    await writeFile(join(dirs.release, sessionId), "");

    mockStdin(JSON.stringify({ session_id: sessionId }));
    const code = await claudeStopHookCommand({
      waitTimeoutMs: 5_000,
      pollIntervalMs: 25,
    });

    expect(code).toBe(0);
    expect(await fileExists(join(dirs.release, sessionId))).toBe(false);
  });

  test("release is consumed once markers drain mid-poll", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");

    await mkdir(dirs.release, { recursive: true });
    await writeFile(join(dirs.release, sessionId), "");

    // Drain the marker after 100 ms.
    setTimeout(() => {
      void rm(join(dirs.inflight, sessionId, agentId), { force: true });
    }, 100);

    mockStdin(JSON.stringify({ session_id: sessionId }));
    const code = await claudeStopHookCommand({
      waitTimeoutMs: 5_000,
      pollIntervalMs: 25,
    });

    expect(code).toBe(0);
    expect(await fileExists(join(dirs.release, sessionId))).toBe(false);
  });

  test("queue marker still takes priority even with inflight markers present", async () => {
    const sessionId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    sessionsToClean.push(sessionId, agentId);

    mockStdin(JSON.stringify({ session_id: sessionId, agent_id: agentId }));
    await claudeInflightHookCommand("start");

    await mkdir(dirs.queue, { recursive: true });
    await writeFile(join(dirs.queue, sessionId), "follow up", "utf-8");

    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: unknown) => boolean }).write = (
      s: unknown,
    ) => {
      stdoutChunks.push(String(s));
      return true;
    };

    try {
      mockStdin(JSON.stringify({ session_id: sessionId }));
      const code = await claudeStopHookCommand({
        waitTimeoutMs: 250,
        pollIntervalMs: 25,
      });
      expect(code).toBe(0);
    } finally {
      (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
    }

    // Queue was consumed and a block decision was emitted with the prompt.
    expect(await fileExists(join(dirs.queue, sessionId))).toBe(false);
    const out = stdoutChunks.join("");
    expect(out).toContain('"decision":"block"');
    expect(out).toContain("follow up");

    // Stat the marker via fs to confirm it stayed put. The queue path takes
    // priority and doesn't touch inflight at all.
    const markerStat = await stat(join(dirs.inflight, sessionId, agentId));
    expect(markerStat.isFile()).toBe(true);
  });
});
