const MOUSE_REPORTING_MODES = new Set([
  "9",
  "1000",
  "1001",
  "1002",
  "1003",
  "1005",
  "1006",
  "1015",
  "1016",
]);

/** Disable all common xterm-compatible terminal mouse reporting modes. */
export const TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE = [
  "\x1b[?9l",
  "\x1b[?1000l",
  "\x1b[?1001l",
  "\x1b[?1002l",
  "\x1b[?1003l",
  "\x1b[?1005l",
  "\x1b[?1006l",
  "\x1b[?1015l",
  "\x1b[?1016l",
].join("");

const PRIVATE_MODE_SEQUENCE_RE = /\x1b\[\?([0-9;:]*)([hl])/g;

/**
 * Strip DECSET mouse-enable modes from streamed PTY output while preserving
 * non-mouse private modes that may be combined in the same CSI sequence.
 */
export function stripTerminalMouseModeEnableSequences(output: string): string {
  return output.replace(
    PRIVATE_MODE_SEQUENCE_RE,
    (sequence: string, rawParams: string, final: string): string => {
      if (final !== "h") return sequence;

      const separator = rawParams.includes(":") ? ":" : ";";
      const params = rawParams.split(/[;:]/).filter((param) => param.length > 0);
      if (params.length === 0) return sequence;

      const keptParams = params.filter((param) => !MOUSE_REPORTING_MODES.has(param));
      if (keptParams.length === params.length) return sequence;
      if (keptParams.length === 0) return "";
      return `\x1b[?${keptParams.join(separator)}h`;
    },
  );
}

function splitTrailingIncompleteEscapeSequence(output: string): { complete: string; pending: string } {
  const lastEscapeIndex = output.lastIndexOf("\x1b");
  if (lastEscapeIndex === -1) return { complete: output, pending: "" };

  const tail = output.slice(lastEscapeIndex);
  if (tail === "\x1b") {
    return { complete: output.slice(0, lastEscapeIndex), pending: tail };
  }

  if (!tail.startsWith("\x1b[")) {
    return { complete: output, pending: "" };
  }

  for (let index = 2; index < tail.length; index++) {
    const code = tail.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return { complete: output, pending: "" };
    }
  }

  return { complete: output.slice(0, lastEscapeIndex), pending: tail };
}

/**
 * Ensure terminal-native drag selection remains available after agent output.
 *
 * Some agent TUIs enable xterm mouse reporting in their PTY output. Because
 * Atomic streams those bytes to the real terminal, that mode would make the
 * terminal send mouse drags to the process instead of selecting text. Strip
 * explicit mouse enables and append a defensive disable sequence for agents
 * that repeatedly toggle the mode.
 */
export function withTerminalMouseReportingDisabled(output: string): string {
  if (output.length === 0) return TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE;
  return stripTerminalMouseModeEnableSequences(output) + TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE;
}

export class TerminalMouseReportingFilter {
  private pending = "";

  write(output: string): string {
    const next = this.pending + output;
    const { complete, pending } = splitTrailingIncompleteEscapeSequence(next);
    this.pending = pending;
    if (complete.length === 0) return "";
    return withTerminalMouseReportingDisabled(complete);
  }

  finish(): string {
    this.pending = "";
    return TERMINAL_MOUSE_REPORTING_DISABLE_SEQUENCE;
  }
}
