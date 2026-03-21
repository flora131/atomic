import { expect, test } from "bun:test";
import type { AgentNodeAgentType } from "@/services/workflows/graph/nodes.ts";

type IsExactlyString<T> = [T] extends [string] ? ([string] extends [T] ? true : false) : false;

const supportsCustomProvider: AgentNodeAgentType = "my-custom-provider";
const assertAgentNodeAgentTypeIsString: IsExactlyString<AgentNodeAgentType> = true;
void supportsCustomProvider;
void assertAgentNodeAgentTypeIsString;

// @ts-expect-error AgentNodeAgentType was removed from graph public API
type RemovedAgentNodeAgentType = (typeof import("@/services/workflows/graph/index.ts"))["AgentNodeAgentType"];
// @ts-expect-error setClientProvider was removed from graph public API
type RemovedSetClientProvider = (typeof import("@/services/workflows/graph/index.ts"))["setClientProvider"];
// @ts-expect-error getClientProvider was removed from graph public API
type RemovedGetClientProvider = (typeof import("@/services/workflows/graph/index.ts"))["getClientProvider"];
// @ts-expect-error setSubagentBridge was removed from graph public API
type RemovedSetSubagentBridge = (typeof import("@/services/workflows/graph/index.ts"))["setSubagentBridge"];
// @ts-expect-error getSubagentBridge was removed from graph public API
type RemovedGetSubagentBridge = (typeof import("@/services/workflows/graph/index.ts"))["getSubagentBridge"];
// @ts-expect-error setSubagentRegistry was removed from graph public API
type RemovedSetSubagentRegistry = (typeof import("@/services/workflows/graph/index.ts"))["setSubagentRegistry"];
// @ts-expect-error setWorkflowResolver was removed from graph public API
type RemovedSetWorkflowResolver = (typeof import("@/services/workflows/graph/index.ts"))["setWorkflowResolver"];
// @ts-expect-error getWorkflowResolver was removed from graph public API
type RemovedGetWorkflowResolver = (typeof import("@/services/workflows/graph/index.ts"))["getWorkflowResolver"];

// @ts-expect-error RalphWorkflowState was removed from graph public API
type RemovedRalphWorkflowStateFromGraph = (typeof import("@/services/workflows/graph/index.ts"))["RalphWorkflowState"];
// @ts-expect-error RalphStateAnnotation was removed from graph public API
type RemovedRalphStateAnnotationFromGraph = (typeof import("@/services/workflows/graph/index.ts"))["RalphStateAnnotation"];
// @ts-expect-error RalphWorkflowState was removed from graph/annotation.ts
type RemovedRalphWorkflowState = (typeof import("@/services/workflows/graph/annotation.ts"))["RalphWorkflowState"];
// @ts-expect-error RalphStateAnnotation was removed from graph/annotation.ts
type RemovedRalphStateAnnotation = (typeof import("@/services/workflows/graph/annotation.ts"))["RalphStateAnnotation"];
// @ts-expect-error createRalphState was removed from graph/annotation.ts
type RemovedCreateRalphState = (typeof import("@/services/workflows/graph/annotation.ts"))["createRalphState"];
// @ts-expect-error updateRalphState was removed from graph/annotation.ts
type RemovedUpdateRalphState = (typeof import("@/services/workflows/graph/annotation.ts"))["updateRalphState"];
// @ts-expect-error isRalphWorkflowState was removed from graph/annotation.ts
type RemovedIsRalphWorkflowState = (typeof import("@/services/workflows/graph/annotation.ts"))["isRalphWorkflowState"];

// --- Legacy GraphExecutor and BFS execution engine removed (Task 22) ---
// @ts-expect-error GraphExecutor was removed from graph public API
type RemovedGraphExecutor = (typeof import("@/services/workflows/graph/index.ts"))["GraphExecutor"];
// @ts-expect-error createExecutor was removed from graph public API
type RemovedCreateExecutor = (typeof import("@/services/workflows/graph/index.ts"))["createExecutor"];
// @ts-expect-error executeGraph was removed from graph public API
type RemovedExecuteGraph = (typeof import("@/services/workflows/graph/index.ts"))["executeGraph"];
// @ts-expect-error streamGraph was removed from graph public API
type RemovedStreamGraph = (typeof import("@/services/workflows/graph/index.ts"))["streamGraph"];
// @ts-expect-error ExecutionOptions was removed from graph public API
type RemovedExecutionOptions = (typeof import("@/services/workflows/graph/index.ts"))["ExecutionOptions"];
// @ts-expect-error StepResult was removed from graph public API
type RemovedStepResult = (typeof import("@/services/workflows/graph/index.ts"))["StepResult"];
// @ts-expect-error EmittedEvent was removed from graph public API
type RemovedEmittedEvent = (typeof import("@/services/workflows/graph/index.ts"))["EmittedEvent"];
// @ts-expect-error ExecutionResult was removed from graph public API
type RemovedExecutionResult = (typeof import("@/services/workflows/graph/index.ts"))["ExecutionResult"];
// @ts-expect-error StreamRouter was removed from graph public API
type RemovedStreamRouter = (typeof import("@/services/workflows/graph/index.ts"))["StreamRouter"];
// @ts-expect-error routeStream was removed from graph public API
type RemovedRouteStream = (typeof import("@/services/workflows/graph/index.ts"))["routeStream"];

// --- Ralph fields removed from CommandContext / CommandContextState (Phase 6, Task 36) ---
// These Ralph-specific fields were extracted to RalphWorkflowContext and must not
// reappear on the shared command interfaces.
import type { CommandContext, CommandContextState } from "@/commands/core/types.ts";

// @ts-expect-error setRalphSessionDir was removed from CommandContext
type RemovedSetRalphSessionDir = CommandContext["setRalphSessionDir"];
// @ts-expect-error setRalphSessionId was removed from CommandContext
type RemovedSetRalphSessionId = CommandContext["setRalphSessionId"];
// @ts-expect-error setRalphTaskIds was removed from CommandContext
type RemovedSetRalphTaskIds = CommandContext["setRalphTaskIds"];
// @ts-expect-error ralphConfig was removed from CommandContextState
type RemovedRalphConfig = CommandContextState["ralphConfig"];
// @ts-expect-error ralphState was removed from CommandContextState
type RemovedRalphState = CommandContextState["ralphState"];
// @ts-expect-error currentNode was removed from CommandContextState
type RemovedCurrentNode = CommandContextState["currentNode"];
// @ts-expect-error iteration was removed from CommandContextState
type RemovedIteration = CommandContextState["iteration"];
// maxIterations is intentionally kept on CommandContextState — it's the conductor's
// iteration limit, wired through CLI → context → executeConductorWorkflow → ConductorConfig.
type MaxIterationsIsPresent = CommandContextState["maxIterations"]; // number | undefined
// @ts-expect-error featureProgress was removed from CommandContextState
type RemovedFeatureProgress = CommandContextState["featureProgress"];
// @ts-expect-error pendingApproval was removed from CommandContextState
type RemovedPendingApproval = CommandContextState["pendingApproval"];
// @ts-expect-error specApproved was removed from CommandContextState
type RemovedSpecApproved = CommandContextState["specApproved"];
// @ts-expect-error feedback was removed from CommandContextState
type RemovedFeedback = CommandContextState["feedback"];
// @ts-expect-error FeatureProgressState was removed (formerly in commands/core/types.ts, then ralph/types.ts)
type RemovedFeatureProgressState = (typeof import("@/commands/core/types.ts"))["FeatureProgressState"];

// --- ralphState removed from WorkflowChatState (Task 11) ---
import type { WorkflowChatState } from "@/state/chat/shared/types/workflow.ts";
// @ts-expect-error ralphState was removed from WorkflowChatState
type RemovedRalphStateFromWorkflowChat = WorkflowChatState["ralphState"];

// @ts-expect-error AgentNodeAgentType must remain a string
const invalidAgentType: AgentNodeAgentType = 123;
void invalidAgentType;

test("compile-time API removal contracts are enforced by typecheck", () => {
  expect(supportsCustomProvider).toBe("my-custom-provider");
});
