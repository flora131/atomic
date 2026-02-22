const MODIFY_OTHER_KEYS_PATTERN = /^\x1b\[27;\d+;\d+~$/;
const CSI_U_CODEPOINT_PATTERN = /^\x1b\[(\d+)/;

export function shouldEnableKittyKeyboardDetection(raw: string | undefined): boolean {
  if (!raw?.startsWith("\x1b[")) {
    return false;
  }

  if (MODIFY_OTHER_KEYS_PATTERN.test(raw)) {
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
