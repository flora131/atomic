import { useCallback } from "react";
import { globalRegistry } from "@/commands/tui/index.ts";
import type { CommandResult } from "@/commands/tui/registry.ts";
import type {
  CommandExecutionTelemetry,
  CommandExecutionTrigger,
} from "@/state/chat/shared/types/index.ts";
import { createCommandContext, startCommandSpinner } from "@/state/chat/command/context-factory.ts";
import { applyCommandResult } from "@/state/chat/command/result-application.ts";
import type { UseCommandExecutorArgs } from "@/state/chat/command/executor-types.ts";

export function useCommandExecutor(args: UseCommandExecutorArgs) {
  return useCallback(async (
    commandName: string,
    argsText: string,
    trigger: CommandExecutionTrigger = "input",
  ): Promise<boolean> => {
    args.setTodoItems([]);

    const command = globalRegistry.get(commandName);
    if (!command) {
      args.addMessage("system", `Unknown command: /${commandName}. Type /help for available commands.`);
      args.onCommandExecutionTelemetry?.({
        commandName,
        commandCategory: "unknown",
        argsLength: argsText.length,
        success: false,
        trigger,
      });
      return false;
    }

    const context = createCommandContext(args);
    const spinner = startCommandSpinner(args, commandName);

    try {
      const result: CommandResult = await Promise.resolve(command.execute(argsText, context));
      spinner.cancelTimer();

      const shouldAddStandaloneResultMessage = Boolean(
        result.message && (!spinner.wasShown() || result.clearMessages),
      );

      await applyCommandResult(args, {
        ...result,
        message: shouldAddStandaloneResultMessage ? result.message : undefined,
      });
      spinner.finalizeWithResult(result);

      args.onCommandExecutionTelemetry?.({
        commandName,
        commandCategory: command.category,
        argsLength: argsText.length,
        success: result.success,
        trigger,
      });
      return result.success;
    } catch (error) {
      spinner.cancelTimer();
      spinner.clearSpinner();

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      args.addMessage("assistant", `Error executing /${commandName}: ${errorMessage}`);
      args.onCommandExecutionTelemetry?.({
        commandName,
        commandCategory: command.category,
        argsLength: argsText.length,
        success: false,
        trigger,
      });
      return false;
    }
  }, [args]);
}
