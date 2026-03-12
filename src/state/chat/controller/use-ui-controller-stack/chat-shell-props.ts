import { buildChatShellProps } from "@/state/chat/shell/props.ts";

export function buildUiControllerChatShellProps<T>(args: T): T {
  return buildChatShellProps(args);
}
