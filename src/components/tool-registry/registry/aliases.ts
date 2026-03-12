import type { ToolRenderer } from "@/components/tool-registry/registry/types.ts";
import { applyPatchToolRenderer } from "@/components/tool-registry/registry/renderers/apply-patch.ts";
import { bashToolRenderer } from "@/components/tool-registry/registry/renderers/bash.ts";
import { editToolRenderer } from "@/components/tool-registry/registry/renderers/edit.ts";
import { globToolRenderer } from "@/components/tool-registry/registry/renderers/glob.ts";
import { grepToolRenderer } from "@/components/tool-registry/registry/renderers/grep.ts";
import { readToolRenderer } from "@/components/tool-registry/registry/renderers/read.ts";
import { skillToolRenderer } from "@/components/tool-registry/registry/renderers/skill.ts";
import { taskToolRenderer } from "@/components/tool-registry/registry/renderers/task.ts";
import { todoWriteToolRenderer } from "@/components/tool-registry/registry/renderers/todo-write.ts";
import { writeToolRenderer } from "@/components/tool-registry/registry/renderers/write.ts";

export function createToolRendererAliases(): Record<string, ToolRenderer> {
  return {
    Read: readToolRenderer,
    read: readToolRenderer,
    Edit: editToolRenderer,
    edit: editToolRenderer,
    Bash: bashToolRenderer,
    bash: bashToolRenderer,
    Write: writeToolRenderer,
    write: writeToolRenderer,
    Glob: globToolRenderer,
    glob: globToolRenderer,
    Grep: grepToolRenderer,
    grep: grepToolRenderer,
    TodoWrite: todoWriteToolRenderer,
    todowrite: todoWriteToolRenderer,
    Task: taskToolRenderer,
    task: taskToolRenderer,
    launch_agent: taskToolRenderer,
    create: writeToolRenderer,
    view: readToolRenderer,
    local_shell: bashToolRenderer,
    powershell: bashToolRenderer,
    str_replace_editor: editToolRenderer,
    str_replace: editToolRenderer,
    apply_patch: applyPatchToolRenderer,
    show_file: readToolRenderer,
    rg: grepToolRenderer,
    MultiEdit: editToolRenderer,
    multiedit: editToolRenderer,
    Skill: skillToolRenderer,
    skill: skillToolRenderer,
  };
}
