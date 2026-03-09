export interface NewlineKeyEventLike {
  name?: string;
  shift?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  raw?: string;
}

/**
 * Returns true when the key event is a bare linefeed (`\n`) with no modifier
 * flags — the ambiguous encoding produced by non-Kitty terminals for
 * Ctrl+J. Callers can use this to suppress the event in the global hook so
 * it doesn't reach the textarea's linefeed→newline binding and cause
 * unwanted newline insertion.
 */
export function isBareLinefeedEvent(event: NewlineKeyEventLike): boolean {
  return (
    event.name === "linefeed"
    && !event.shift
    && !event.ctrl
    && !event.meta
    && event.raw === "\n"
  );
}

export function shouldInsertNewlineFromKeyEvent(event: NewlineKeyEventLike): boolean {
  return (
    ((event.name === "return" || event.name === "linefeed") && (event.shift || event.meta)) ||
    (event.name === "linefeed" && !event.ctrl && !event.shift && !event.meta) ||
    (event.name !== "return"
      && event.name !== "linefeed"
      && event.raw?.endsWith("u")
      && /^\x1b\[(?:13|10)/.test(event.raw)
      && event.raw.includes(";")) ||
    (event.name === "return"
      && !event.shift
      && event.raw != null
      && event.raw !== "\r"
      && event.raw !== "\n"
      && event.raw.includes(";2"))
  );
}

/**
 * Terminal-specific fallback newline detection for use in the global key handler.
 *
 * Standard shift+enter / meta+enter / Ctrl+J newlines are handled by the
 * OpenTUI textarea's `keyBindings` prop (see `textareaKeyBindings` in chat.tsx).
 * This function only matches escape-sequence-based edge cases that can't be
 * expressed as simple keybindings — e.g. Kitty-protocol CSI-u sequences or
 * modifyOtherKeys-style raw codes where the parsed key name / modifiers don't
 * accurately reflect the original Shift+Enter press.
 */
export function shouldInsertNewlineFallbackFromKeyEvent(event: NewlineKeyEventLike): boolean {
  return (
    // CSI-u escape sequence (Kitty protocol): raw ends with "u" and starts
    // with ESC[13 or ESC[10 (Enter / Linefeed codepoints) with a modifier.
    (event.name !== "return"
      && event.name !== "linefeed"
      && event.raw?.endsWith("u")
      && /^\x1b\[(?:13|10)/.test(event.raw)
      && event.raw.includes(";")) ||
    // modifyOtherKeys-style shifted return: event.name is "return" but the
    // shift flag isn't set; instead the raw sequence contains ";2" (shift
    // modifier) and differs from a plain "\r" / "\n".
    (event.name === "return"
      && !event.shift
      && event.raw != null
      && event.raw !== "\r"
      && event.raw !== "\n"
      && event.raw.includes(";2"))
  );
}

export function shouldApplyBackslashLineContinuation(value: string, kittyKeyboardDetected: boolean): boolean {
  return !kittyKeyboardDetected && value.endsWith("\\");
}
