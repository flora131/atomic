import { useEffect, useRef, type RefObject } from "react";
import { parseSlashCommand } from "@/commands/tui/index.ts";
import { useCommandExecutor } from "@/state/chat/command/index.ts";
import type { UseCommandExecutorArgs } from "@/state/chat/shared/types/command.ts";
import type {
  CommandExecutionTrigger,
  MessageSubmitTelemetry,
} from "@/state/chat/shared/types/index.ts";
import { processFileMentions } from "@/lib/ui/mention-parsing.ts";

export interface UseCommandDispatchArgs
  extends Omit<UseCommandExecutorArgs, "addMessage" | "sendMessageRef"> {
  addMessage: (role: "user" | "assistant" | "system", content: string) => void;
  emitMessageSubmitTelemetry: (event: MessageSubmitTelemetry) => void;
  initialPrompt?: string;
  sendMessage: (
    content: string,
    options?: { skipUserMessage?: boolean },
  ) => void;
  sendMessageRef: RefObject<
    | ((
        content: string,
        options?: { skipUserMessage?: boolean },
      ) => void)
    | null
  >;
}

export interface UseCommandDispatchResult {
  executeCommand: (
    commandName: string,
    args: string,
    trigger?: CommandExecutionTrigger,
  ) => Promise<boolean>;
}

export function useCommandDispatch({
  addMessage,
  emitMessageSubmitTelemetry,
  initialPrompt,
  sendMessage,
  sendMessageRef,
  ...commandExecutorArgs
}: UseCommandDispatchArgs): UseCommandDispatchResult {
  const executeCommand = useCommandExecutor({
    addMessage,
    sendMessageRef,
    ...commandExecutorArgs,
  });

  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (initialPromptSentRef.current || !initialPrompt) {
      return;
    }

    const timeoutId = setTimeout(() => {
      initialPromptSentRef.current = true;

      const parsed = parseSlashCommand(initialPrompt);
      if (parsed.isCommand) {
        addMessage("user", initialPrompt);
        void executeCommand(parsed.name, parsed.args, "initial_prompt");
        return;
      }

      const { message: processed, filesRead } =
        processFileMentions(initialPrompt);
      emitMessageSubmitTelemetry({
        messageLength: initialPrompt.length,
        queued: false,
        fromInitialPrompt: true,
        hasFileMentions: filesRead.length > 0,
        hasAgentMentions: false,
      });
      sendMessage(processed);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [
    addMessage,
    emitMessageSubmitTelemetry,
    executeCommand,
    initialPrompt,
    sendMessage,
  ]);

  return { executeCommand };
}
