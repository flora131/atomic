import { useCallback } from "react";

/**
 * Coordinates dialog-level interactions such as copy behaviour that
 * must choose between textarea selection and renderer selection.
 */
export function useDialogController({
  textareaRef,
  clipboard,
  copyRendererSelection,
}: {
  textareaRef: { readonly current: { hasSelection(): boolean; getSelectedText(): string } | null };
  clipboard: { copy(text: string): void };
  copyRendererSelection: () => void;
}) {
  const handleCopy = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea?.hasSelection()) {
      const selectedText = textarea.getSelectedText();
      if (selectedText) {
        clipboard.copy(selectedText);
        return;
      }
    }
    copyRendererSelection();
  }, [clipboard, copyRendererSelection, textareaRef]);

  return { handleCopy };
}
