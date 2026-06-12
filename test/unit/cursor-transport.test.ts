import { test, describe } from "bun:test";
import assert from "node:assert/strict";
import type { Api, Context, Model } from "@earendil-works/pi-ai";
import {
	decodeCursorConnectFrames,
	encodeCursorConnectFrame,
	Http2CursorAgentTransport,
	type CursorConnectFrame,
	type CursorHttp2Client,
	type CursorHttp2StreamHandle,
	type CursorProtocolCodec,
	type CursorRunRequest,
	type CursorServerMessage,
} from "../../packages/cursor/src/transport.js";

class FakeStreamHandle implements CursorHttp2StreamHandle {
	readonly writes: Uint8Array[] = [];
	readonly frames: AsyncIterable<Uint8Array>;
	closed = false;
	cancelled = false;

	constructor(frames: readonly Uint8Array[]) {
		this.frames = (async function* (): AsyncIterable<Uint8Array> {
			for (const frame of frames) yield frame;
		})();
	}

	async write(data: Uint8Array): Promise<void> {
		this.writes.push(data);
	}

	async close(): Promise<void> {
		this.closed = true;
	}

	async cancel(): Promise<void> {
		this.cancelled = true;
	}
}

class FakeHttp2Client implements CursorHttp2Client {
	unaryRequests: Array<{ path: string; headers: Record<string, string>; body: Uint8Array }> = [];
	streamRequests: Array<{ path: string; headers: Record<string, string> }> = [];
	streamHandle: FakeStreamHandle;
	unaryBody = new Uint8Array([1, 2, 3]);
	disposed = false;

	constructor(frames: readonly Uint8Array[] = []) {
		this.streamHandle = new FakeStreamHandle(frames);
	}

	async requestUnary(request: { readonly path: string; readonly headers: Record<string, string>; readonly body: Uint8Array }): Promise<{ readonly body: Uint8Array; readonly headers: Record<string, string>; readonly statusCode?: number }> {
		this.unaryRequests.push({ path: request.path, headers: request.headers, body: request.body });
		return { statusCode: 200, body: this.unaryBody, headers: {} };
	}

	async openStream(request: { readonly path: string; readonly headers: Record<string, string> }): Promise<CursorHttp2StreamHandle> {
		this.streamRequests.push({ path: request.path, headers: request.headers });
		return this.streamHandle;
	}

	async dispose(): Promise<void> {
		this.disposed = true;
	}
}

class FakeCodec implements CursorProtocolCodec {
	readonly modelRequest = new Uint8Array([9]);
	readonly runRequest = new Uint8Array([8]);
	readonly cancelRequest = new Uint8Array([7]);
	readonly heartbeatRequest = new Uint8Array([6]);
	decodedUnary: Uint8Array | undefined;
	decodedFrames: CursorConnectFrame[] = [];

	encodeGetUsableModelsRequest(): Uint8Array {
		return this.modelRequest;
	}

	decodeGetUsableModelsResponse(data: Uint8Array) {
		this.decodedUnary = data;
		return [{ id: "composer-2", displayName: "Composer 2", supportsThinking: true }];
	}

	encodeRunRequest(_request: CursorRunRequest): Uint8Array {
		return this.runRequest;
	}

	decodeRunFrame(frame: CursorConnectFrame): readonly CursorServerMessage[] {
		this.decodedFrames.push(frame);
		const value = frame.data[0];
		if (value === 1) return [{ type: "textDelta", text: "hi" }];
		if (value === 2) return [{ type: "thinkingDelta", text: "think" }];
		if (value === 3) return [{ type: "usage", inputTokens: 4, outputTokens: 5 }];
		return [{ type: "done", reason: "stop" }];
	}

	encodeCancelRequest(): Uint8Array {
		return this.cancelRequest;
	}

	encodeHeartbeatRequest(): Uint8Array {
		return this.heartbeatRequest;
	}
}

const model: Model<Api> = {
	id: "composer-2",
	name: "Composer 2",
	provider: "cursor",
	api: "cursor-agent" as Api,
	baseUrl: "https://api2.cursor.sh",
	input: ["text"],
	reasoning: false,
	contextWindow: 200_000,
	maxTokens: 64_000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const context: Context = { messages: [], systemPrompt: "" };

describe("Cursor HTTP2 transport boundary", () => {
	test("encodes and decodes Connect frames", () => {
		const encoded = encodeCursorConnectFrame(new Uint8Array([1, 2, 3]), 2);
		assert.deepEqual([...encoded], [2, 0, 0, 0, 3, 1, 2, 3]);
		const decoded = decodeCursorConnectFrames(encoded);
		assert.equal(decoded.length, 1);
		assert.equal(decoded[0]?.endStream, true);
		assert.deepEqual([...(decoded[0]?.data ?? [])], [1, 2, 3]);
	});

	test("getUsableModels sends Cursor headers/path/body and decodes response", async () => {
		const client = new FakeHttp2Client();
		const codec = new FakeCodec();
		const transport = new Http2CursorAgentTransport({ client, codec });
		const models = await transport.getUsableModels("secret-token", "request-1");
		assert.equal(models[0]?.id, "composer-2");
		assert.equal(client.unaryRequests[0]?.path, "/agent.v1.AgentService/GetUsableModels");
		assert.equal(client.unaryRequests[0]?.headers.authorization, "Bearer secret-token");
		assert.equal(client.unaryRequests[0]?.headers["content-type"], "application/proto");
		assert.deepEqual([...(client.unaryRequests[0]?.body ?? [])], [9]);
		assert.deepEqual([...(codec.decodedUnary ?? [])], [1, 2, 3]);
	});

	test("run writes a framed request and decodes streamed messages", async () => {
		const client = new FakeHttp2Client([
			encodeCursorConnectFrame(new Uint8Array([1])),
			encodeCursorConnectFrame(new Uint8Array([2])),
			encodeCursorConnectFrame(new Uint8Array([3])),
			encodeCursorConnectFrame(new Uint8Array([4])),
		]);
		const codec = new FakeCodec();
		const transport = new Http2CursorAgentTransport({ client, codec });
		const run = await transport.run({ accessToken: "secret", requestId: "run-1", model, resolvedModelId: "composer-2", context });
		assert.equal(client.streamRequests[0]?.path, "/agent.v1.AgentService/Run");
		assert.equal(client.streamRequests[0]?.headers["connect-protocol-version"], "1");
		assert.deepEqual([...decodeCursorConnectFrames(client.streamHandle.writes[0] ?? new Uint8Array())[0]!.data], [8]);
		const messages: CursorServerMessage[] = [];
		for await (const message of run.messages) messages.push(message);
		assert.deepEqual(messages.map((message) => message.type), ["textDelta", "thinkingDelta", "usage", "done"]);
		await run.close();
		assert.deepEqual(transport.getLifecycleSnapshot(), { openStreams: 0, cancelledStreams: 0, closedStreams: 1 });
	});

	test("cancel writes a framed cancel request and updates lifecycle", async () => {
		const client = new FakeHttp2Client();
		const codec = new FakeCodec();
		const transport = new Http2CursorAgentTransport({ client, codec });
		const run = await transport.run({ accessToken: "secret", requestId: "run-2", model, resolvedModelId: "composer-2", context });
		await run.cancel();
		assert.deepEqual([...decodeCursorConnectFrames(client.streamHandle.writes[1] ?? new Uint8Array())[0]!.data], [7]);
		assert.equal(client.streamHandle.cancelled, true);
		assert.deepEqual(transport.getLifecycleSnapshot(), { openStreams: 0, cancelledStreams: 1, closedStreams: 1 });
	});

	test("aborted requests fail without the previous unconditional stub message", async () => {
		const controller = new AbortController();
		controller.abort();
		const transport = new Http2CursorAgentTransport({ client: new FakeHttp2Client(), codec: new FakeCodec() });
		await assert.rejects(
			() => transport.run({ accessToken: "secret", requestId: "run-3", model, resolvedModelId: "composer-2", context, signal: controller.signal }),
			(error: Error) => !error.message.includes("deferred; no proxy or child-process bridge"),
		);
	});
});
