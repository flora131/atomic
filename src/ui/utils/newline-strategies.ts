export interface NewlineKeyEventLike {
  name?: string;
  shift?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  raw?: string;
}

export function getEnqueueShortcutLabel(platform: NodeJS.Platform | string = process.platform): string {
  return platform === "darwin" ? "cmd+shift+enter" : "ctrl+shift+enter";
}

/**
 * Detect Ctrl+Shift+Enter (or Cmd+Shift+Enter on macOS) from a raw CSI-u or
 * modifyOtherKeys escape sequence. This is a fallback for cases where the
 * terminal sends an enhanced sequence but the parsed key event doesn't
 * correctly reflect the modifier state.
 */
function isEnqueueFromRawSequence(raw: string, platform: string): boolean {
  // CSI-u: \x1b[13;Mu or \x1b[10;Mu (Enter/Linefeed codepoint with modifiers)
  const csiUMatch = raw.match(/^\x1b\[(?:13|10);(\d+)(?::\d+)*u$/);
  if (csiUMatch) {
    const mods = parseInt(csiUMatch[1]!, 10) - 1;
    const hasShift = (mods & 1) !== 0;
    const hasCtrl = (mods & 4) !== 0;
    const hasMeta = (mods & 8) !== 0;
    if (platform === "darwin") return hasShift && hasMeta && !hasCtrl;
    return hasShift && hasCtrl && !hasMeta;
  }
  // modifyOtherKeys: \x1b[27;M;13~ or \x1b[27;M;10~
  const modMatch = raw.match(/^\x1b\[27;(\d+);(?:13|10)~$/);
  if (modMatch) {
    const mods = parseInt(modMatch[1]!, 10) - 1;
    const hasShift = (mods & 1) !== 0;
    const hasCtrl = (mods & 4) !== 0;
    const hasMeta = (mods & 8) !== 0;
    if (platform === "darwin") return hasShift && hasMeta && !hasCtrl;
    return hasShift && hasCtrl && !hasMeta;
  }
  return false;
}

export function shouldEnqueueMessageFromKeyEvent(
  event: NewlineKeyEventLike,
  platform: NodeJS.Platform | string = process.platform,
): boolean {
  const isEnterKey = event.name === "return" || event.name === "linefeed";
  if (!isEnterKey || !event.shift) {
    // Fallback: check raw escape sequence for Ctrl+Shift+Enter when parsed
    // modifiers are missing (e.g. terminal sends CSI-u but parser doesn't
    // set shift/ctrl on the event object).
    if (event.raw && isEnqueueFromRawSequence(event.raw, platform)) {
      return true;
    }
    return false;
  }

  if (platform === "darwin") {
    return Boolean(event.meta) && !event.ctrl;
  }

  return Boolean(event.ctrl) && !event.meta;
}

/**
 * Returns true when the key event is a bare linefeed (`\n`) with no modifier
 * flags — the ambiguous encoding produced by non-Kitty terminals for both
 * Ctrl+J and Ctrl+Shift+Enter. Callers can use this to suppress the event
 * in the global hook so it doesn't reach the textarea's linefeed→newline
 * binding and cause unwanted newline insertion on Ctrl+Shift+Enter.
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
  // Never treat the enqueue shortcut (ctrl+shift+enter / cmd+shift+enter) as a newline
  if (shouldEnqueueMessageFromKeyEvent(event)) {
    return false;
  }
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
  if (shouldEnqueueMessageFromKeyEvent(event)) {
    return false;
  }

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
