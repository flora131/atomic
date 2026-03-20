/**
 * Part Renderer Registry
 *
 * Maps Part types to their renderer components for dynamic dispatch.
 * Each renderer receives { part, isLast } props where the part is
 * narrowed to the specific subtype via the discriminant.
 */

import type { SyntaxStyle } from "@opentui/core";
import type { Part } from "@/state/parts/types.ts";
import { TextPartDisplay } from "@/components/message-parts/text-part-display.tsx";
import { ReasoningPartDisplay } from "@/components/message-parts/reasoning-part-display.tsx";
import { ToolPartDisplay } from "@/components/message-parts/tool-part-display.tsx";
import { AgentPartDisplay } from "@/components/message-parts/agent-part-display.tsx";
import { TaskListPartDisplay } from "@/components/message-parts/task-list-part-display.tsx";
import { SkillLoadPartDisplay } from "@/components/message-parts/skill-load-part-display.tsx";
import { McpSnapshotPartDisplay } from "@/components/message-parts/mcp-snapshot-part-display.tsx";
import { AgentListPartDisplay } from "@/components/message-parts/agent-list-part-display.tsx";
import { CompactionPartDisplay } from "@/components/message-parts/compaction-part-display.tsx";
import { TaskResultPartDisplay } from "@/components/message-parts/task-result-part-display.tsx";
import { WorkflowStepPartDisplay } from "@/components/message-parts/workflow-step-part-display.tsx";

/**
 * Renderer function signature for a Part subtype.
 *
 * The registry dispatches based on `part.type`, so the caller guarantees
 * the part is narrowed to the correct subtype before invoking the renderer.
 * Each renderer function accepts its own narrowed Part subtype in practice,
 * but the registry stores them under a common signature for dynamic lookup.
 */
export type PartRenderer = (props: {
  part: Part;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
  onAgentDoneRendered?: (marker: { agentId: string; timestampMs: number }) => void;
}) => React.ReactNode;

// The individual renderers accept narrowed Part subtypes (e.g., TextPart,
// ToolPart), but the registry performs dynamic dispatch based on part.type.
// The caller is responsible for passing the correctly-typed part. We use
// a type-safe cast here since the registry key guarantees the correct subtype.
export const PART_REGISTRY: Record<Part["type"], PartRenderer> = {
  "text": TextPartDisplay as unknown as PartRenderer,
  "reasoning": ReasoningPartDisplay as unknown as PartRenderer,
  "tool": ToolPartDisplay as unknown as PartRenderer,
  "agent": AgentPartDisplay as unknown as PartRenderer,
  "task-list": TaskListPartDisplay as unknown as PartRenderer,
  "skill-load": SkillLoadPartDisplay as unknown as PartRenderer,
  "mcp-snapshot": McpSnapshotPartDisplay as unknown as PartRenderer,
  "agent-list": AgentListPartDisplay as unknown as PartRenderer,
  "compaction": CompactionPartDisplay as unknown as PartRenderer,
  "task-result": TaskResultPartDisplay as unknown as PartRenderer,
  "workflow-step": WorkflowStepPartDisplay as unknown as PartRenderer,
};
