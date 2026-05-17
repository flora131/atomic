import type { Component, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { KeybindingsManager, Theme } from "@bastani/atomic";
import type { IntercomClient } from "../broker/client.js";
import type { SessionInfo } from "../types.js";

export interface ComposeResult {
  sent: boolean;
  messageId?: string;
  text?: string;
}

export class ComposeOverlay implements Component {
  private tui: TUI;
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private target: SessionInfo;
  private targetLabel: string;
  private client: IntercomClient;
  private done: (result: ComposeResult) => void;
  private inputBuffer: string = "";
  private sending: boolean = false;
  private error: string | null = null;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    target: SessionInfo,
    targetLabel: string,
    client: IntercomClient,
    done: (result: ComposeResult) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.target = target;
    this.targetLabel = targetLabel;
    this.client = client;
    this.done = done;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.sending) return;
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done({ sent: false });
      return;
    }

    if (data.startsWith("\x1b")) {
      return;
    }

    if (this.keybindings.matches(data, "tui.select.confirm")) {
      if (this.inputBuffer.trim()) {
        this.sendMessage();
      }
      return;
    }

    if (this.keybindings.matches(data, "tui.editor.deleteCharBackward")) {
      this.inputBuffer = [...this.inputBuffer].slice(0, -1).join("");
      this.tui.requestRender();
      return;
    }

    const printable = [...data].filter(c => c >= " ").join("");
    if (printable) {
      this.inputBuffer += printable;
      this.tui.requestRender();
    }
  }

  private async sendMessage(): Promise<void> {
    this.sending = true;
    this.error = null;
    this.tui.requestRender();

    try {
      const result = await this.client.send(this.target.id, {
        text: this.inputBuffer.trim(),
      });
      
      if (!result.delivered) {
        this.error = result.reason ?? "Message not delivered. Session may not exist or has disconnected.";
        this.sending = false;
        this.tui.requestRender();
        return;
      }
      
      this.done({
        sent: true,
        messageId: result.id,
        text: this.inputBuffer.trim(),
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.sending = false;
      this.tui.requestRender();
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(24, Math.min(width - 2, 72));
    const contentWidth = Math.max(1, innerWidth - 2);
    const footer = `${this.keybindings.getKeys("tui.select.confirm").join("/")}: Send • ${this.keybindings.getKeys("tui.select.cancel").join("/")}: Close`;
    const border = (text: string) => this.theme.fg("accent", text);
    const row = (text = "") => {
      const clipped = truncateToWidth(text, contentWidth, "", true);
      return `${border("│")}${clipped}${" ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))}${border("│")}`;
    };

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(contentWidth)}╮`));
    lines.push(row(this.theme.bold(` Send to: ${this.targetLabel}`)));
    lines.push(row(this.theme.fg("dim", ` ${this.target.cwd} • ${this.target.model}`)));
    lines.push(border(`├${"─".repeat(contentWidth)}┤`));
    lines.push(row());

    if (this.sending) {
      lines.push(row(this.theme.fg("dim", " Sending...")));
    } else if (this.error) {
      lines.push(row(this.theme.fg("error", ` Error: ${this.error}`)));
      lines.push(row());
      lines.push(row(` > ${this.inputBuffer}█`));
    } else {
      lines.push(row(` > ${this.inputBuffer}█`));
    }

    lines.push(row());
    lines.push(border(`├${"─".repeat(contentWidth)}┤`));
    lines.push(row(this.theme.fg("dim", ` ${footer}`)));
    lines.push(border(`╰${"─".repeat(contentWidth)}╯`));

    return lines;
  }
}
