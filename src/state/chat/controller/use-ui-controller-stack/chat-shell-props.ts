import { buildChatShellProps } from "@/state/chat/shell/index.ts";

export function buildUiControllerChatShellProps<T>(args: T): T {
  return buildChatShellProps(args);
}
