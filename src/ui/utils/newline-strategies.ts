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

export function shouldEnqueueMessageFromKeyEvent(
  event: NewlineKeyEventLike,
  platform: NodeJS.Platform | string = process.platform,
): boolean {
  const isEnterKey = event.name === "return" || event.name === "linefeed";
  if (!isEnterKey || !event.shift) {
    return false;
  }

  if (platform === "darwin") {
    return Boolean(event.meta) && !event.ctrl;
  }

  return Boolean(event.ctrl) && !event.meta;
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

export function shouldApplyBackslashLineContinuation(value: string, kittyKeyboardDetected: boolean): boolean {
  return !kittyKeyboardDetected && value.endsWith("\\");
}
