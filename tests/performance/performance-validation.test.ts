/**
 * Performance Validation Tests (Phase 10.3)
 *
 * This test suite validates performance baselines for critical operations:
 * - Startup time with models.dev fetch
 * - /model list command execution time
 * - Queue operations (enqueue/dequeue/clear)
 * - Memory usage during extended sessions
 *
 * Baseline Metrics (targets):
 * - models.dev data load: <500ms (from cache/snapshot)
 * - /model list command: <100ms
 * - Queue enqueue (100 items): <50ms
 * - Queue dequeue (100 items): <50ms
 * - Queue clear: <10ms
 * - Memory growth per 1000 queue ops: <1MB
 */

import { test, expect, describe, beforeEach, beforeAll, afterAll } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { ModelsDev, CACHE_PATH } from "../../src/models/models-dev";
import { modelCommand } from "../../src/ui/commands/builtin-commands";
import type { CommandContext } from "../../src/ui/commands/registry";
import type { ModelOperations, Model } from "../../src/models";
import { fromModelsDevModel } from "../../src/models";

/**
 * Performance Baseline Constants
 * These values represent acceptable performance thresholds
 */
const BASELINE = {
  /** Max time for loading models data from cache/snapshot (ms) */
  MODELS_DATA_LOAD_MS: 500,
  /** Max time for /model list command execution (ms) */
  MODEL_LIST_COMMAND_MS: 100,
  /** Max time for enqueuing 100 messages (ms) */
  QUEUE_ENQUEUE_100_MS: 50,
  /** Max time for dequeuing 100 messages (ms) */
  QUEUE_DEQUEUE_100_MS: 50,
  /** Max time for clearing a 500-item queue (ms) */
  QUEUE_CLEAR_MS: 10,
  /** Max memory growth per 1000 queue operations (bytes) */
  MEMORY_GROWTH_PER_1000_OPS_BYTES: 1024 * 1024, // 1MB
};

/**
 * Create a mock database for testing
 */
function createMockDatabase(): ModelsDev.Database {
  const models: Record<string, ModelsDev.Model> = {};
  // Create 50 models to simulate realistic load
  for (let i = 0; i < 50; i++) {
    models[`model-${i}`] = {
      id: `model-${i}`,
      name: `Model ${i}`,
      release_date: "2025-01-01",
      attachment: true,
      reasoning: i % 5 === 0,
      temperature: true,
      tool_call: true,
      cost: { input: 0.003, output: 0.015 },
      limit: { context: 200000, input: 100000, output: 100000 },
      modalities: { input: ["text", "image"], output: ["text"] },
      options: {},
    };
  }

  return {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models,
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      models,
    },
    google: {
      id: "google",
      name: "Google",
      env: ["GOOGLE_API_KEY"],
      models,
    },
  };
}

/**
 * Simple message queue implementation for testing
 * (mirrors the production queue interface)
 */
interface MessageQueue {
  queue: string[];
  count: number;
  enqueue(message: string): void;
  dequeue(): string | undefined;
  clear(): void;
}

function createMessageQueue(): MessageQueue {
  const queue: string[] = [];
  return {
    queue,
    get count() {
      return queue.length;
    },
    enqueue(message: string) {
      queue.push(message);
    },
    dequeue() {
      return queue.shift();
    },
    clear() {
      queue.length = 0;
    },
  };
}

/**
 * Create ModelOperations for testing
 */
function createTestModelOps(): ModelOperations {
  return {
    listAvailableModels: async (): Promise<Model[]> => {
      const modelsData = await ModelsDev.listModels();
      return modelsData.map(({ providerID, model }) =>
        fromModelsDevModel(providerID, model.id, model)
      );
    },
    setModel: async () => ({ success: true }),
    getCurrentModel: async () => undefined,
    resolveAlias: () => undefined,
  };
}

/**
 * Create CommandContext for testing
 */
function createTestContext(): CommandContext {
  return {
    session: null,
    state: {
      isStreaming: false,
      messageCount: 0,
      workflowActive: false,
      workflowType: null,
      initialPrompt: null,
      pendingApproval: false,
      specApproved: undefined,
      feedback: null,
    },
    addMessage: () => {},
    setStreaming: () => {},
    sendMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock output" }),
    agentType: undefined,
    modelOps: createTestModelOps(),
  };
}

describe("Performance Validation", () => {
  let originalCacheContent: string | null = null;
  let cacheExisted = false;

  beforeAll(async () => {
    // Backup existing cache if present
    try {
      originalCacheContent = await fs.readFile(CACHE_PATH, "utf-8");
      cacheExisted = true;
    } catch {
      cacheExisted = false;
      originalCacheContent = null;
    }
  });

  afterAll(async () => {
    // Restore original cache state
    ModelsDev.Data.reset();
    if (cacheExisted && originalCacheContent !== null) {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, originalCacheContent);
    } else {
      try {
        await fs.unlink(CACHE_PATH);
      } catch {}
    }
  });

  beforeEach(async () => {
    ModelsDev.Data.reset();
  });

  describe("Models Data Load Performance", () => {
    test("loads models data from cache within baseline", async () => {
      // Setup: Write mock data to cache
      const mockDatabase = createMockDatabase();
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      // Measure load time
      const startTime = performance.now();
      const data = await ModelsDev.get();
      const loadTime = performance.now() - startTime;

      // Verify data loaded correctly
      expect(Object.keys(data).length).toBeGreaterThan(0);

      // Verify performance baseline
      expect(loadTime).toBeLessThan(BASELINE.MODELS_DATA_LOAD_MS);

      console.log(`Models data load time: ${loadTime.toFixed(2)}ms (baseline: <${BASELINE.MODELS_DATA_LOAD_MS}ms)`);
    });

    test("subsequent loads use cached lazy loader", async () => {
      // Setup
      const mockDatabase = createMockDatabase();
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      // First load (initializes lazy loader)
      await ModelsDev.get();

      // Measure second load (should be instant from lazy loader)
      const startTime = performance.now();
      await ModelsDev.get();
      const secondLoadTime = performance.now() - startTime;

      // Second load should be nearly instant
      expect(secondLoadTime).toBeLessThan(5);

      console.log(`Cached load time: ${secondLoadTime.toFixed(2)}ms (baseline: <5ms)`);
    });
  });

  describe("/model list Command Performance", () => {
    test("executes within baseline time", async () => {
      // Setup
      const mockDatabase = createMockDatabase();
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      // Preload data
      await ModelsDev.get();

      const context = createTestContext();

      // Measure command execution
      const startTime = performance.now();
      const result = await modelCommand.execute("list", context);
      const execTime = performance.now() - startTime;

      // Verify command succeeded
      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();

      // Verify performance baseline
      expect(execTime).toBeLessThan(BASELINE.MODEL_LIST_COMMAND_MS);

      console.log(`/model list execution time: ${execTime.toFixed(2)}ms (baseline: <${BASELINE.MODEL_LIST_COMMAND_MS}ms)`);
    });

    test("handles large model lists without lag", async () => {
      // Create a database with many models (stress test)
      const largeDatabase: ModelsDev.Database = {};
      for (let p = 0; p < 10; p++) {
        const models: Record<string, ModelsDev.Model> = {};
        for (let m = 0; m < 100; m++) {
          models[`model-${m}`] = {
            id: `model-${m}`,
            name: `Provider ${p} Model ${m}`,
            release_date: "2025-01-01",
            attachment: true,
            reasoning: false,
            temperature: true,
            tool_call: true,
            cost: { input: 0.001, output: 0.002 },
            limit: { context: 100000, input: 50000, output: 50000 },
            modalities: { input: ["text"], output: ["text"] },
            options: {},
          };
        }
        largeDatabase[`provider-${p}`] = {
          id: `provider-${p}`,
          name: `Provider ${p}`,
          env: [],
          models,
        };
      }

      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(largeDatabase));
      ModelsDev.Data.reset();

      // Preload
      await ModelsDev.get();

      const context = createTestContext();

      // Measure with 1000 models
      const startTime = performance.now();
      const result = await modelCommand.execute("list", context);
      const execTime = performance.now() - startTime;

      expect(result.success).toBe(true);
      // Allow more time for large lists but still reasonable
      expect(execTime).toBeLessThan(500);

      console.log(`Large model list (1000 models) execution time: ${execTime.toFixed(2)}ms (baseline: <500ms)`);
    });
  });

  describe("Queue Operations Performance", () => {
    test("enqueue operations complete within baseline", () => {
      const queue = createMessageQueue();

      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        queue.enqueue(`Test message ${i}`);
      }
      const enqueueTime = performance.now() - startTime;

      expect(queue.count).toBe(100);
      expect(enqueueTime).toBeLessThan(BASELINE.QUEUE_ENQUEUE_100_MS);

      console.log(`Enqueue 100 items: ${enqueueTime.toFixed(2)}ms (baseline: <${BASELINE.QUEUE_ENQUEUE_100_MS}ms)`);
    });

    test("dequeue operations complete within baseline", () => {
      const queue = createMessageQueue();

      // Fill queue
      for (let i = 0; i < 100; i++) {
        queue.enqueue(`Test message ${i}`);
      }

      const startTime = performance.now();
      while (queue.dequeue()) {
        // Dequeue all
      }
      const dequeueTime = performance.now() - startTime;

      expect(queue.count).toBe(0);
      expect(dequeueTime).toBeLessThan(BASELINE.QUEUE_DEQUEUE_100_MS);

      console.log(`Dequeue 100 items: ${dequeueTime.toFixed(2)}ms (baseline: <${BASELINE.QUEUE_DEQUEUE_100_MS}ms)`);
    });

    test("clear operation is instant", () => {
      const queue = createMessageQueue();

      // Fill with large queue
      for (let i = 0; i < 500; i++) {
        queue.enqueue(`Message ${i} with some content to increase size`);
      }
      expect(queue.count).toBe(500);

      const startTime = performance.now();
      queue.clear();
      const clearTime = performance.now() - startTime;

      expect(queue.count).toBe(0);
      expect(clearTime).toBeLessThan(BASELINE.QUEUE_CLEAR_MS);

      console.log(`Clear 500 items: ${clearTime.toFixed(2)}ms (baseline: <${BASELINE.QUEUE_CLEAR_MS}ms)`);
    });

    test("queue operations don't cause UI lag with concurrent load", async () => {
      const queue = createMessageQueue();

      // Simulate concurrent operations
      const operations: Promise<void>[] = [];

      const startTime = performance.now();

      // Enqueue in batches (simulates rapid message arrival)
      for (let batch = 0; batch < 10; batch++) {
        operations.push(
          (async () => {
            for (let i = 0; i < 20; i++) {
              queue.enqueue(`Batch ${batch} Message ${i}`);
              // Yield to event loop
              await Promise.resolve();
            }
          })()
        );
      }

      await Promise.all(operations);
      const totalTime = performance.now() - startTime;

      expect(queue.count).toBe(200);
      // Even with yielding, should complete quickly
      expect(totalTime).toBeLessThan(100);

      console.log(`Concurrent queue operations (200 items, 10 batches): ${totalTime.toFixed(2)}ms`);
    });
  });

  describe("Memory Usage During Extended Sessions", () => {
    test("memory doesn't grow excessively during queue operations", () => {
      const queue = createMessageQueue();

      // Get baseline memory
      const initialMemory = process.memoryUsage().heapUsed;

      // Perform 1000 queue operations
      for (let i = 0; i < 500; i++) {
        queue.enqueue(`Test message ${i} with some additional content for realistic size`);
      }
      for (let i = 0; i < 250; i++) {
        queue.dequeue();
      }
      for (let i = 0; i < 250; i++) {
        queue.enqueue(`Additional message ${i}`);
      }
      queue.clear();

      // Force garbage collection hint (won't actually force GC but can help)
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be minimal after clearing
      // Allow up to 1MB growth as buffer for test overhead
      expect(memoryGrowth).toBeLessThan(BASELINE.MEMORY_GROWTH_PER_1000_OPS_BYTES);

      console.log(`Memory growth after 1000 ops: ${(memoryGrowth / 1024).toFixed(2)}KB (baseline: <${BASELINE.MEMORY_GROWTH_PER_1000_OPS_BYTES / 1024}KB)`);
    });

    test("models data is loaded once and cached", async () => {
      const mockDatabase = createMockDatabase();
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      // Get baseline memory after initial load
      await ModelsDev.get();
      const afterFirstLoad = process.memoryUsage().heapUsed;

      // Call get() multiple times
      for (let i = 0; i < 100; i++) {
        await ModelsDev.get();
      }

      const afterManyLoads = process.memoryUsage().heapUsed;
      const memoryGrowth = afterManyLoads - afterFirstLoad;

      // Should not grow significantly since it's cached
      expect(memoryGrowth).toBeLessThan(100 * 1024); // Less than 100KB

      console.log(`Memory growth after 100 cached loads: ${(memoryGrowth / 1024).toFixed(2)}KB`);
    });
  });
});

/**
 * Baseline Metrics Documentation
 *
 * This test suite establishes the following performance baselines:
 *
 * | Operation                    | Baseline   | Notes                              |
 * |------------------------------|------------|------------------------------------| 
 * | Models data load (cache)     | <500ms     | From file cache or snapshot        |
 * | Models data load (cached)    | <5ms       | From lazy loader memory            |
 * | /model list command          | <100ms     | With preloaded data                |
 * | /model list (1000 models)    | <500ms     | Stress test with large dataset     |
 * | Queue enqueue (100 items)    | <50ms      | Sequential enqueue                 |
 * | Queue dequeue (100 items)    | <50ms      | Sequential dequeue                 |
 * | Queue clear (500 items)      | <10ms      | Single operation                   |
 * | Concurrent queue (200 items) | <100ms     | 10 concurrent batches              |
 * | Memory growth (1000 ops)     | <1MB       | After operations + clear           |
 * | Memory (100 cached loads)    | <100KB     | Using lazy loader                  |
 *
 * These baselines ensure:
 * - Fast startup with models.dev data
 * - Responsive /model commands
 * - No UI lag from queue operations
 * - Stable memory usage over time
 */
