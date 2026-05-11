import { test, expect, describe } from "bun:test";
import { ConcurrencyLimiter, createRunLimiter } from "./concurrency.js";

describe("ConcurrencyLimiter", () => {
  test("throws for limit < 1", () => {
    expect(() => new ConcurrencyLimiter(0)).toThrow("positive integer");
    expect(() => new ConcurrencyLimiter(-1)).toThrow("positive integer");
  });

  test("throws for non-integer limit", () => {
    expect(() => new ConcurrencyLimiter(1.5)).toThrow("positive integer");
  });

  test("exposes limit, running, queued properties", async () => {
    const lim = new ConcurrencyLimiter(2);
    expect(lim.limit).toBe(2);
    expect(lim.running).toBe(0);
    expect(lim.queued).toBe(0);

    await lim.acquire();
    expect(lim.running).toBe(1);
    lim.release();
    expect(lim.running).toBe(0);
  });

  test("allows up to limit concurrent acquires without blocking", async () => {
    const lim = new ConcurrencyLimiter(3);
    await lim.acquire();
    await lim.acquire();
    await lim.acquire();
    expect(lim.running).toBe(3);
    expect(lim.queued).toBe(0);
    lim.release();
    lim.release();
    lim.release();
    expect(lim.running).toBe(0);
  });

  test("queues acquires beyond limit", async () => {
    const lim = new ConcurrencyLimiter(1);

    await lim.acquire(); // fills the only slot

    let resolved = false;
    const waiter = lim.acquire().then(() => { resolved = true; });

    // Before release — waiter should not have resolved yet
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);
    expect(lim.queued).toBe(1);

    lim.release(); // unblock the waiter

    await waiter;
    expect(resolved).toBe(true);
    expect(lim.running).toBe(1); // slot handed directly to waiter
    lim.release();
    expect(lim.running).toBe(0);
  });

  test("run() wraps acquire/release around async fn", async () => {
    const lim = new ConcurrencyLimiter(2);
    const order: string[] = [];

    await Promise.all([
      lim.run(async () => { order.push("a"); return "a"; }),
      lim.run(async () => { order.push("b"); return "b"; }),
    ]);

    expect(order).toContain("a");
    expect(order).toContain("b");
    expect(lim.running).toBe(0);
  });

  test("run() releases slot even when fn throws", async () => {
    const lim = new ConcurrencyLimiter(1);

    await expect(lim.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");

    expect(lim.running).toBe(0);

    // Slot should be available again
    const result = await lim.run(async () => "ok");
    expect(result).toBe("ok");
  });

  test("enforces serialization with limit=1", async () => {
    const lim = new ConcurrencyLimiter(1);
    const concurrentPeak = { value: 0 };
    let active = 0;
    let maxSeen = 0;

    const task = async (): Promise<void> => {
      await lim.acquire();
      active++;
      maxSeen = Math.max(maxSeen, active);
      // yield to allow other tasks to interleave if limit is broken
      await new Promise<void>((r) => setTimeout(r, 1));
      active--;
      lim.release();
    };

    await Promise.all([task(), task(), task()]);
    concurrentPeak.value = maxSeen;

    expect(concurrentPeak.value).toBe(1);
  });

  test("enforces limit=2 — never exceeds two concurrent tasks", async () => {
    const lim = new ConcurrencyLimiter(2);
    let active = 0;
    let maxSeen = 0;

    const task = async (): Promise<void> => {
      await lim.acquire();
      active++;
      maxSeen = Math.max(maxSeen, active);
      await new Promise<void>((r) => setTimeout(r, 1));
      active--;
      lim.release();
    };

    await Promise.all([task(), task(), task(), task(), task()]);

    expect(maxSeen).toBeLessThanOrEqual(2);
  });
});

describe("createRunLimiter", () => {
  test("uses provided defaultConcurrency", () => {
    const lim = createRunLimiter(3);
    expect(lim.limit).toBe(3);
  });

  test("defaults to 4 when no value provided", () => {
    const lim = createRunLimiter();
    expect(lim.limit).toBe(4);
  });

  test("defaults to 4 when undefined", () => {
    const lim = createRunLimiter(undefined);
    expect(lim.limit).toBe(4);
  });
});
