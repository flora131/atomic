import { expect, test } from "bun:test";
import type {
  ClaudeProviderEvent,
  CopilotProviderEvent,
  OpenCodeProviderEvent,
} from "@/services/agents/provider-events.ts";

type IsNever<T> = [T] extends [never] ? true : false;
type Expect<T extends true> = T;

type ClaudeMessageDeltaNative = Extract<ClaudeProviderEvent, { type: "message.delta" }>["native"];
type OpenCodeMessageDeltaNative = Extract<OpenCodeProviderEvent, { type: "message.delta" }>["native"];
type CopilotToolCompleteNative = Extract<CopilotProviderEvent, { type: "tool.complete" }>["native"];

type ClaudeMessageDeltaAcceptsStreamEvent = Expect<
  IsNever<Extract<ClaudeMessageDeltaNative, { type: "result" }>>
>;
type OpenCodeMessageDeltaRejectsSessionCreated = Expect<
  IsNever<Extract<OpenCodeMessageDeltaNative, { type: "session.created" }>>
>;
type CopilotToolCompleteRejectsAssistantMessage = Expect<
  IsNever<Extract<CopilotToolCompleteNative, { type: "assistant.message" }>>
>;

const claudeNativeNarrowingCheck: ClaudeMessageDeltaAcceptsStreamEvent = true;
const openCodeNativeNarrowingCheck: OpenCodeMessageDeltaRejectsSessionCreated = true;
const copilotNativeNarrowingCheck: CopilotToolCompleteRejectsAssistantMessage = true;

void claudeNativeNarrowingCheck;
void openCodeNativeNarrowingCheck;
void copilotNativeNarrowingCheck;

test("provider event native unions stay narrowed by normalized type", () => {
  expect(true).toBe(true);
});
