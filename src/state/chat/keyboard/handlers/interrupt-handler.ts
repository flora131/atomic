/**
 * Interrupt Handler — Ctrl+C & Escape Interrupt Controls
 *
 * Re-exports the interrupt control hook and related functions from
 * the parent module. The hook manages multi-press Ctrl+C confirmation,
 * foreground agent interruption, and workflow cancellation.
 *
 * @module
 */

export { useChatInterruptControls } from "@/state/chat/keyboard/use-interrupt-controls.ts";
export { interruptForegroundAgents, interruptStreaming } from "@/state/chat/keyboard/interrupt-execution.ts";
export {
  useInterruptConfirmation,
  type UseInterruptConfirmationResult,
} from "@/state/chat/keyboard/use-interrupt-confirmation.ts";
