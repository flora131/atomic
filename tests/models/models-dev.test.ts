import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import { tmpdir } from "os";
import { ModelsDev, CACHE_PATH } from "../../src/models/models-dev";

describe("ModelsDev", () => {
  const mockDatabase: ModelsDev.Database = {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: {
        "claude-sonnet-4": {
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          release_date: "2025-01-01",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.003, output: 0.015 },
          limit: { context: 200000, input: 100000, output: 100000 },
          modalities: { input: ["text", "image"], output: ["text"] },
          options: {}
        }
      }
    },
    openai: {
      id: "openai",
      name: "OpenAI",
      env: ["OPENAI_API_KEY"],
      models: {
        "gpt-4o": {
          id: "gpt-4o",
          name: "GPT-4o",
          release_date: "2024-05-01",
          attachment: true,
          reasoning: false,
          temperature: true,
          tool_call: true,
          cost: { input: 0.005, output: 0.015 },
          limit: { context: 128000, input: 64000, output: 64000 },
          modalities: { input: ["text", "image"], output: ["text"] },
          options: {}
        }
      }
    }
  };

  // Backup original cache file if exists
  let originalCacheContent: string | null = null;
  let cacheExisted = false;

  beforeEach(async () => {
    // Reset the lazy loader before each test
    ModelsDev.Data.reset();

    // Backup existing cache if present
    try {
      originalCacheContent = await fs.readFile(CACHE_PATH, "utf-8");
      cacheExisted = true;
    } catch {
      cacheExisted = false;
      originalCacheContent = null;
    }
  });

  afterEach(async () => {
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

  describe("get()", () => {
    test("returns data from cache when available", async () => {
      // Write mock data to cache
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const data = await ModelsDev.get();

      expect(data).toEqual(mockDatabase);
      expect(data.anthropic).toBeDefined();
      expect(data.anthropic!.models["claude-sonnet-4"]).toBeDefined();
    });

    test("falls back to snapshot or empty when cache missing", async () => {
      // Remove cache file
      try {
        await fs.unlink(CACHE_PATH);
      } catch {}
      ModelsDev.Data.reset();

      // Disable fetch for this test
      const originalEnv = process.env.ATOMIC_DISABLE_MODELS_FETCH;
      process.env.ATOMIC_DISABLE_MODELS_FETCH = "1";

      try {
        const data = await ModelsDev.get();
        // Should return snapshot data or empty object
        expect(typeof data).toBe("object");
      } finally {
        if (originalEnv === undefined) {
          delete process.env.ATOMIC_DISABLE_MODELS_FETCH;
        } else {
          process.env.ATOMIC_DISABLE_MODELS_FETCH = originalEnv;
        }
      }
    });
  });

  describe("refresh()", () => {
    test("updates cache file", async () => {
      // Mock global fetch
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDatabase)
        } as Response)
      ) as unknown as typeof fetch;

      try {
        await ModelsDev.refresh();

        // Verify cache file was written
        const cacheContent = await fs.readFile(CACHE_PATH, "utf-8");
        const parsed = JSON.parse(cacheContent);
        expect(parsed).toEqual(mockDatabase);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    test("resets lazy loader after refresh", async () => {
      // Write initial data
      const initialData: ModelsDev.Database = {
        testprovider: {
          id: "testprovider",
          name: "Test Provider",
          env: [],
          models: {}
        }
      };
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(initialData));
      ModelsDev.Data.reset();

      // Get initial data
      const data1 = await ModelsDev.get();
      expect(data1.testprovider).toBeDefined();

      // Mock fetch for refresh
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDatabase)
        } as Response)
      ) as unknown as typeof fetch;

      try {
        await ModelsDev.refresh();

        // Get data after refresh - should be new data
        const data2 = await ModelsDev.get();
        expect(data2.anthropic).toBeDefined();
        expect(data2.testprovider).toBeUndefined();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("listModels()", () => {
    test("returns flattened array of all models", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const models = await ModelsDev.listModels();

      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBe(2);

      const anthropicModel = models.find(m => m.providerID === "anthropic");
      expect(anthropicModel).toBeDefined();
      expect(anthropicModel!.model.id).toBe("claude-sonnet-4");

      const openaiModel = models.find(m => m.providerID === "openai");
      expect(openaiModel).toBeDefined();
      expect(openaiModel!.model.id).toBe("gpt-4o");
    });

    test("returns empty array when no providers available", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify({}));
      ModelsDev.Data.reset();

      const models = await ModelsDev.listModels();

      expect(models).toEqual([]);
    });
  });

  describe("getModel()", () => {
    test("returns specific model by provider and model ID", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const model = await ModelsDev.getModel("anthropic", "claude-sonnet-4");

      expect(model).toBeDefined();
      expect(model!.name).toBe("Claude Sonnet 4");
      expect(model!.cost.input).toBe(0.003);
    });

    test("returns undefined for non-existent model", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const model = await ModelsDev.getModel("anthropic", "non-existent");

      expect(model).toBeUndefined();
    });

    test("returns undefined for non-existent provider", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const model = await ModelsDev.getModel("non-existent", "some-model");

      expect(model).toBeUndefined();
    });
  });

  describe("getProvider()", () => {
    test("returns provider info by ID", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const provider = await ModelsDev.getProvider("anthropic");

      expect(provider).toBeDefined();
      expect(provider!.name).toBe("Anthropic");
      expect(provider!.env).toEqual(["ANTHROPIC_API_KEY"]);
      expect(provider!.models["claude-sonnet-4"]).toBeDefined();
    });

    test("returns undefined for non-existent provider", async () => {
      await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
      await fs.writeFile(CACHE_PATH, JSON.stringify(mockDatabase));
      ModelsDev.Data.reset();

      const provider = await ModelsDev.getProvider("non-existent");

      expect(provider).toBeUndefined();
    });
  });
});
