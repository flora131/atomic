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

export type PartRenderer = (props: {
  part: any;
  isLast: boolean;
  syntaxStyle?: SyntaxStyle;
  onAgentDoneRendered?: (marker: { agentId: string; timestampMs: number }) => void;
}) => React.ReactNode;

export const PART_REGISTRY: Record<Part["type"], PartRenderer> = {
  "text": TextPartDisplay,
  "reasoning": ReasoningPartDisplay,
  "tool": ToolPartDisplay,
  "agent": AgentPartDisplay,
  "task-list": TaskListPartDisplay,
  "skill-load": SkillLoadPartDisplay,
  "mcp-snapshot": McpSnapshotPartDisplay,
  "agent-list": AgentListPartDisplay,
  "compaction": CompactionPartDisplay,
  "task-result": TaskResultPartDisplay,
  "workflow-step": WorkflowStepPartDisplay,
};
