import { Text, type Component } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

export interface WorkingStatusComponentOptions {
  /** Current spinner frame. Pass an empty string to render message-only status. */
  spinner?: string;
  /** Status text displayed after the spinner. */
  message?: string;
  /** Optional spinner colorizer. Defaults to the active interactive accent. */
  spinnerColor?: (text: string) => string;
  /** Optional message colorizer. Defaults to muted interactive text. */
  messageColor?: (text: string) => string;
}

/**
 * Inline working status used above the composer.
 *
 * This preserves the same geometry as pi-tui's Loader, which is the primitive
 * used by the main coding-agent chat: one leading blank row plus a one-cell
 * text gutter before the spinner/message row.
 */
export class WorkingStatusComponent implements Component {
  declare private readonly options: WorkingStatusComponentOptions;

  constructor(options: WorkingStatusComponentOptions = {}) {
    this.options = options;
	}

  render(width: number): string[] {
    const spinner = this.options.spinner ?? "⠋";
    const message = this.options.message ?? "Working...";
    const spinnerColor =
      this.options.spinnerColor ??
      ((text: string) => theme.fg("accent", text));
    const messageColor =
      this.options.messageColor ?? ((text: string) => theme.fg("muted", text));
    const indicator = spinner ? `${spinnerColor(spinner)} ` : "";
    return [
      "",
      ...new Text(`${indicator}${messageColor(message)}`, 1, 0).render(width),
    ];
  }

  invalidate(): void {}
}
