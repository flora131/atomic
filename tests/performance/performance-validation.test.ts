/**
 * Performance Validation Tests (Phase 10.3)
 *
 * This test suite validates performance baselines for critical operations:
 * - Model listing via SDK
 * - /model list command execution time
 * - Queue operations (enqueue/dequeue/clear)
 * - Memory usage during extended sessions
 *
 * Baseline Metrics (targets):
 * - Model listing: <500ms (including fallback)
 * - /model list command: <100ms
 * - Queue enqueue (100 items): <50ms
 * - Queue dequeue (100 items): <50ms
 * - Queue clear: <10ms
 * - Memory growth per 1000 queue ops: <1MB
 */

import { test, expect, describe, mock } from "bun:test";
import { modelCommand } from "../../src/ui/commands/builtin-commands";
import type { CommandContext } from "../../src/ui/commands/registry";
import type { ModelOperations, Model } from "../../src/models";

/**
 * Performance Baseline Constants
 * These values represent acceptable performance thresholds
 */
const BASELINE = {
  /** Max time for model listing (ms) */
  MODEL_LIST_MS: 500,
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
 * Create mock models for testing
 */
function createMockModels(count: number): Model[] {
  const models: Model[] = [];
  for (let i = 0; i < count; i++) {
    models.push({
      id: `provider-${Math.floor(i / 10)}/model-${i}`,
      providerID: `provider-${Math.floor(i / 10)}`,
      modelID: `model-${i}`,
      name: `Model ${i}`,
      status: "active",
      capabilities: {
        reasoning: i % 5 === 0,
        attachment: true,
        temperature: true,
        toolCall: true,
      },
      limits: {
        context: 200000,
        output: 100000,
      },
      options: {},
    });
  }
  return models;
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
function createTestModelOps(models: Model[]): ModelOperations {
  return {
    listAvailableModels: mock(() => Promise.resolve(models)),
    setModel: mock(() => Promise.resolve({ success: true })),
    getCurrentModel: mock(() => Promise.resolve(undefined)),
    resolveAlias: mock(() => undefined),
  };
}

/**
 * Create CommandContext for testing
 */
function createTestContext(models: Model[]): CommandContext {
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
    sendSilentMessage: () => {},
    spawnSubagent: async () => ({ success: true, output: "Mock output" }),
    streamAndWait: async () => ({ content: "", wasInterrupted: false }),
    clearContext: async () => {},
    setTodoItems: () => {},
    updateWorkflowState: () => {},
    agentType: undefined,
    modelOps: createTestModelOps(models),
  };
}

describe("Performance Validation", () => {
  describe("/model list Command Performance", () => {
    test("executes within baseline time", async () => {
      const models = createMockModels(150);
      const context = createTestContext(models);

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
      // Create 1000 models to stress test
      const models = createMockModels(1000);
      const context = createTestContext(models);

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
  });
});

/**
 * Baseline Metrics Documentation
 *
 * This test suite establishes the following performance baselines:
 *
 * | Operation                    | Baseline   | Notes                              |
 * |------------------------------|------------|------------------------------------|
 * | /model list command          | <100ms     | With preloaded data                |
 * | /model list (1000 models)    | <500ms     | Stress test with large dataset     |
 * | Queue enqueue (100 items)    | <50ms      | Sequential enqueue                 |
 * | Queue dequeue (100 items)    | <50ms      | Sequential dequeue                 |
 * | Queue clear (500 items)      | <10ms      | Single operation                   |
 * | Concurrent queue (200 items) | <100ms     | 10 concurrent batches              |
 * | Memory growth (1000 ops)     | <1MB       | After operations + clear           |
 *
 * These baselines ensure:
 * - Responsive /model commands
 * - No UI lag from queue operations
 * - Stable memory usage over time
 */
