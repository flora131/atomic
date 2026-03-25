import { useChatDispatchController } from "@/state/chat/controller/use-dispatch-controller.ts";
import { useChatKeyboard } from "@/state/chat/keyboard/index.ts";
import { useChatRenderModel } from "@/state/chat/shell/index.ts";
import { useComposerController } from "@/state/chat/composer/index.ts";
import type { UseChatUiControllerStackArgs } from "./types.ts";
import { useOrchestrationState } from "./use-orchestration-state.ts";
import { useDialogController } from "./use-dialog-controller.ts";
import { useChatShellPropsBuilder } from "./use-chat-shell-props-builder.ts";

/**
 * Thin façade that wires the orchestrated state through the four
 * sub-hook stages (dispatch → composer → keyboard → render) and
 * assembles the final chatShellProps.
 */
export function useChatUiControllerStack(args: UseChatUiControllerStackArgs) {
  const o = useOrchestrationState(args);

  // Stage 1 – dispatch
  const dispatch = useChatDispatchController(o);

  // Stage 2 – composer (depends on dispatch results)
  const composer = useComposerController({
    ...o,
    addMessage: dispatch.addMessage,
    executeCommand: dispatch.executeCommand,
    sendMessage: dispatch.sendMessage,
  });

  // Stage 3 – dialog (copy coordination between textarea & renderer)
  const { handleCopy } = useDialogController({
    textareaRef: composer.textareaRef,
    clipboard: o.clipboard,
    copyRendererSelection: o.copyRendererSelection,
  });

  // Stage 4 – keyboard (depends on dispatch, composer, and dialog)
  const keyboard = useChatKeyboard({
    ...o,
    ...composer,
    addMessage: dispatch.addMessage,
    executeCommand: dispatch.executeCommand,
    handleCopy,
  });

  // Stage 5 – render model (independent of dispatch/composer/keyboard)
  const renderModel = useChatRenderModel({
    ...o,
    backgroundAgentMessageId: o.backgroundAgentMessageIdRef.current,
    lastStreamedMessageId: o.lastStreamedMessageIdRef.current,
    streamingMessageId: o.streamingMessageIdRef.current,
  });

  // Stage 6 – assemble chatShellProps from all stages
  return useChatShellPropsBuilder({
    o,
    dispatch,
    composer,
    ctrlCPressed: keyboard.ctrlCPressed,
    messageContent: renderModel.messageContent,
  });
}
