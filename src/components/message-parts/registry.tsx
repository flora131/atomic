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
  /** When true, renderers should show a compact summary instead of full output. */
  summaryOnly?: boolean;
}) => React.ReactNode;

/**
 * Type-safe registry builder. Ensures the registry covers every Part type
 * at compile time via the required keys. The single cast at the boundary is
 * intentional: each renderer accepts a narrowed Part subtype, but the registry
 * stores them under the wider PartRenderer signature for dynamic dispatch.
 * This replaces 11 individual `as unknown as` casts with one controlled cast.
 */
function buildPartRegistry(
  entries: Record<Part["type"], (...args: never[]) => React.ReactNode>,
): Record<Part["type"], PartRenderer> {
  return entries as Record<Part["type"], PartRenderer>;
}

// The individual renderers accept narrowed Part subtypes (e.g., TextPart,
// ToolPart), but the registry performs dynamic dispatch based on part.type.
// The caller is responsible for passing the correctly-typed part. The
// buildPartRegistry helper ensures compile-time coverage of all Part types.
export const PART_REGISTRY = buildPartRegistry({
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
});
