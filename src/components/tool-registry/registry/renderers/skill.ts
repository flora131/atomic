import { STATUS } from "@/theme/icons.ts";
import type { ToolRenderProps, ToolRenderResult, ToolRenderer } from "@/components/tool-registry/registry/types.ts";

function getSkillName(props: ToolRenderProps): string {
  return (props.input.skill as string) || (props.input.name as string) || "unknown";
}

export const skillToolRenderer: ToolRenderer = {
  icon: STATUS.active,

  getTitle(props: ToolRenderProps): string {
    return `Skill(${getSkillName(props)})`;
  },

  render(props: ToolRenderProps): ToolRenderResult {
    return {
      title: `Skill(${getSkillName(props)})`,
      content: ["Successfully loaded skill"],
      expandable: false,
    };
  },
};
