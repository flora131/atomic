import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ContextCompactionResult } from "../src/core/compaction/index.ts";
import { RpcClient, type RpcEvent, type RpcEventListener } from "../src/modes/rpc/rpc-client.ts";

type RpcClientPrivate = {
	send: (command: { type: string }) => Promise<unknown>;
	getData: <T>(response: unknown) => T;
};

describe("RpcClient clone", () => {
	it("sends the clone RPC command", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const send = vi.fn(async () => ({
			type: "response",
			command: "clone",
			success: true,
			data: { cancelled: false },
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => {
			return (response as { data: T }).data;
		};

		const result = await client.clone();

		expect(send).toHaveBeenCalledWith({ type: "clone" });
		expect(result).toEqual({ cancelled: false });
	});
});

describe("RpcClient event typing", () => {
	it("exposes session events so context_compaction_end can be narrowed", () => {
		const client = new RpcClient();
		const listener: RpcEventListener = (event) => {
			if (event.type === "context_compaction_end") {
				expectTypeOf(event.result).toEqualTypeOf<ContextCompactionResult | undefined>();
			}
		};
		const unsubscribe = client.onEvent(listener);
		const event = {
			type: "context_compaction_end",
			reason: "manual",
			result: undefined,
			aborted: false,
			willRetry: false,
		} satisfies RpcEvent;

		expectTypeOf<Parameters<RpcClient["onEvent"]>[0]>().toEqualTypeOf<RpcEventListener>();
		expectTypeOf<Awaited<ReturnType<RpcClient["collectEvents"]>>>().toEqualTypeOf<RpcEvent[]>();
		expectTypeOf<Awaited<ReturnType<RpcClient["promptAndWait"]>>>().toEqualTypeOf<RpcEvent[]>();
		if (event.type === "context_compaction_end") {
			const result: ContextCompactionResult | undefined = event.result;
			expect(result).toBeUndefined();
		}
		unsubscribe();
	});
});

describe("RpcClient contextCompact", () => {
	it("sends the context_compact RPC command", async () => {
		const client = new RpcClient();
		const privateClient = client as unknown as RpcClientPrivate;
		const contextCompactionResult = {
			deletedTargets: [],
			protectedEntryIds: [],
			stats: {
				objectsBefore: 2,
				objectsAfter: 1,
				objectsDeleted: 1,
				tokensBefore: 100,
				tokensAfter: 50,
				percentReduction: 50,
			},
			promptVersion: 1,
		};
		const send = vi.fn(async () => ({
			type: "response",
			command: "context_compact",
			success: true,
			data: contextCompactionResult,
		}));
		privateClient.send = send;
		privateClient.getData = <T>(response: unknown): T => {
			return (response as { data: T }).data;
		};

		const result = await client.contextCompact();

		expect(send).toHaveBeenCalledWith({ type: "context_compact" });
		expect(result).toEqual(contextCompactionResult);
	});
});
