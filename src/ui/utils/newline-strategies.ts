export interface NewlineKeyEventLike {
  name?: string;
  shift?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  raw?: string;
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
