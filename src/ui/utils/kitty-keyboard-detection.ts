const MODIFY_OTHER_KEYS_ENTER_PATTERN = /^\x1b\[27;[2-9]\d*;13~$/;
const CSI_U_CODEPOINT_PATTERN = /^\x1b\[(\d+)/;

export function shouldEnableKittyKeyboardDetection(raw: string | undefined): boolean {
  if (!raw?.startsWith("\x1b[")) {
    return false;
  }

  // Only detect modifyOtherKeys if it's specifically for Enter with modifiers (Shift, Alt, Ctrl, etc.)
  // This ensures we only disable the backslash fallback when the terminal actually
  // sends proper modified Enter sequences, not just when it supports modifyOtherKeys in general.
  // Pattern: \x1b[27;modifier;13~ where modifier >= 2 (indicating at least one modifier key)
  if (MODIFY_OTHER_KEYS_ENTER_PATTERN.test(raw)) {
    return true;
  }

  if (!raw.endsWith("u")) {
    return false;
  }

  const codepointMatch = CSI_U_CODEPOINT_PATTERN.exec(raw);
  if (!codepointMatch) {
    return false;
  }

  const codepoint = codepointMatch[1];
  return codepoint === "13" || codepoint === "10";
}

export function getNextKittyKeyboardDetectionState(
  currentState: boolean,
  raw: string | undefined,
): boolean {
  if (currentState) {
    return true;
  }

  return shouldEnableKittyKeyboardDetection(raw);
}
