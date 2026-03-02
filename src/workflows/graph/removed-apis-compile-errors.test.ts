import { expect, test } from "bun:test";
import type { AgentNodeAgentType } from "./nodes.ts";

type IsExactlyString<T> = [T] extends [string] ? ([string] extends [T] ? true : false) : false;

const supportsCustomProvider: AgentNodeAgentType = "my-custom-provider";
const assertAgentNodeAgentTypeIsString: IsExactlyString<AgentNodeAgentType> = true;
void supportsCustomProvider;
void assertAgentNodeAgentTypeIsString;

// @ts-expect-error AgentNodeAgentType was removed from graph public API
type RemovedAgentNodeAgentType = (typeof import("./index.ts"))["AgentNodeAgentType"];
// @ts-expect-error setClientProvider was removed from graph public API
type RemovedSetClientProvider = (typeof import("./index.ts"))["setClientProvider"];
// @ts-expect-error getClientProvider was removed from graph public API
type RemovedGetClientProvider = (typeof import("./index.ts"))["getClientProvider"];
// @ts-expect-error setSubagentBridge was removed from graph public API
type RemovedSetSubagentBridge = (typeof import("./index.ts"))["setSubagentBridge"];
// @ts-expect-error getSubagentBridge was removed from graph public API
type RemovedGetSubagentBridge = (typeof import("./index.ts"))["getSubagentBridge"];
// @ts-expect-error setSubagentRegistry was removed from graph public API
type RemovedSetSubagentRegistry = (typeof import("./index.ts"))["setSubagentRegistry"];
// @ts-expect-error setWorkflowResolver was removed from graph public API
type RemovedSetWorkflowResolver = (typeof import("./index.ts"))["setWorkflowResolver"];
// @ts-expect-error getWorkflowResolver was removed from graph public API
type RemovedGetWorkflowResolver = (typeof import("./index.ts"))["getWorkflowResolver"];

// @ts-expect-error RalphWorkflowState was removed from graph public API
type RemovedRalphWorkflowStateFromGraph = (typeof import("./index.ts"))["RalphWorkflowState"];
// @ts-expect-error RalphStateAnnotation was removed from graph public API
type RemovedRalphStateAnnotationFromGraph = (typeof import("./index.ts"))["RalphStateAnnotation"];
// @ts-expect-error RalphWorkflowState was removed from graph/annotation.ts
type RemovedRalphWorkflowState = (typeof import("./annotation.ts"))["RalphWorkflowState"];
// @ts-expect-error RalphStateAnnotation was removed from graph/annotation.ts
type RemovedRalphStateAnnotation = (typeof import("./annotation.ts"))["RalphStateAnnotation"];
// @ts-expect-error createRalphState was removed from graph/annotation.ts
type RemovedCreateRalphState = (typeof import("./annotation.ts"))["createRalphState"];
// @ts-expect-error updateRalphState was removed from graph/annotation.ts
type RemovedUpdateRalphState = (typeof import("./annotation.ts"))["updateRalphState"];
// @ts-expect-error isRalphWorkflowState was removed from graph/annotation.ts
type RemovedIsRalphWorkflowState = (typeof import("./annotation.ts"))["isRalphWorkflowState"];

// @ts-expect-error AgentNodeAgentType must remain a string
const invalidAgentType: AgentNodeAgentType = 123;
void invalidAgentType;

test("compile-time API removal contracts are enforced by typecheck", () => {
  expect(supportsCustomProvider).toBe("my-custom-provider");
});
