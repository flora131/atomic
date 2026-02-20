/**
 * Part Renderer Registry
 *
 * Maps Part types to their renderer components for dynamic dispatch.
 * Each renderer receives { part, isLast } props where the part is
 * narrowed to the specific subtype via the discriminant.
 */

import type { SyntaxStyle } from "@opentui/core";
import type { Part } from "../../parts/types.ts";
import { TextPartDisplay } from "./text-part-display.tsx";
import { ReasoningPartDisplay } from "./reasoning-part-display.tsx";
import { ToolPartDisplay } from "./tool-part-display.tsx";
import { AgentPartDisplay } from "./agent-part-display.tsx";
import { TaskListPartDisplay } from "./task-list-part-display.tsx";
import { SkillLoadPartDisplay } from "./skill-load-part-display.tsx";
import { McpSnapshotPartDisplay } from "./mcp-snapshot-part-display.tsx";
import { CompactionPartDisplay } from "./compaction-part-display.tsx";

export type PartRenderer = (props: { part: any; isLast: boolean; syntaxStyle?: SyntaxStyle }) => React.ReactNode;

export const PART_REGISTRY: Record<Part["type"], PartRenderer> = {
  "text": TextPartDisplay,
  "reasoning": ReasoningPartDisplay,
  "tool": ToolPartDisplay,
  "agent": AgentPartDisplay,
  "task-list": TaskListPartDisplay,
  "skill-load": SkillLoadPartDisplay,
  "mcp-snapshot": McpSnapshotPartDisplay,
  "compaction": CompactionPartDisplay,
};
