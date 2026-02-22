// Only match modifyOtherKeys sequences for Enter (codepoint 13) with a real
// modifier (>=2). Plain Enter (\x1b[27;1;13~) must NOT trigger detection because
// some terminals encode plain Enter this way while still sending Shift+Enter as
// "\" + "\r" (the backslash fallback we need to keep active).
const MODIFY_OTHER_KEYS_ENTER_PATTERN = /^\x1b\[27;[2-9]\d*;13~$/;
const CSI_U_CODEPOINT_PATTERN = /^\x1b\[(\d+)/;

export function shouldEnableKittyKeyboardDetection(raw: string | undefined): boolean {
  if (!raw?.startsWith("\x1b[")) {
    return false;
  }

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

  // Only detect CSI-u Enter/Linefeed when a modifier is present (e.g.,
  // \x1b[13;2u for Shift+Enter). Plain \x1b[13u (no semicolon) must NOT
  // trigger detection — some terminals partially support Kitty protocol
  // for unmodified keys but still send Shift+Enter as "\" + "\r".
  const codepoint = codepointMatch[1];
  return (codepoint === "13" || codepoint === "10") && raw.includes(";");
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
