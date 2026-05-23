import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { EditorComponent, TUI } from "@earendil-works/pi-tui";
import {
  extensionForImageMimeType,
  readClipboardImage,
} from "../../utils/clipboard-image.ts";

export interface ExternalEditorHost {
  stop(): void;
  start(): void;
  requestRender(force?: boolean): void;
}

export interface ExternalEditorOptions {
  editorCommand?: string;
  showWarning?: (message: string) => void;
}

export function combineQueuedMessagesForEditor(
  queuedMessages: readonly string[],
  currentText: string,
): string {
  return [
    ...queuedMessages,
    ...(currentText.trim() ? [currentText] : []),
  ].join("\n\n");
}

export interface ClipboardImageEditorTarget {
  insertTextAtCursor?: (text: string) => void;
  getText?: () => string;
  setText?: (text: string) => void;
}

export async function pasteClipboardImageToEditor(
  editor: ClipboardImageEditorTarget,
  requestRender?: () => void,
): Promise<boolean> {
  try {
    const image = await readClipboardImage();
    if (!image) return false;

    const ext = extensionForImageMimeType(image.mimeType) ?? "png";
    const fileName = `pi-clipboard-${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(os.tmpdir(), fileName);
    fs.writeFileSync(filePath, Buffer.from(image.bytes));

    if (editor.insertTextAtCursor) editor.insertTextAtCursor(filePath);
    else if (editor.getText && editor.setText) editor.setText(`${editor.getText()}${filePath}`);
    else return false;
    requestRender?.();
    return true;
  } catch {
    return false;
  }
}

export function openExternalEditorForText(
  text: string,
  host: Pick<TUI, "stop" | "start" | "requestRender"> | ExternalEditorHost,
  options: ExternalEditorOptions = {},
): string | undefined {
  const editorCommand = options.editorCommand ?? process.env.VISUAL ?? process.env.EDITOR;
  if (!editorCommand) {
    options.showWarning?.("No editor configured. Set $VISUAL or $EDITOR environment variable.");
    return undefined;
  }

  const tmpFile = path.join(os.tmpdir(), `pi-editor-${Date.now()}.pi.md`);
  try {
    fs.writeFileSync(tmpFile, text, "utf-8");
    host.stop();

    const [editor, ...editorArgs] = editorCommand.split(" ");
    if (!editor) return undefined;
    const result = spawnSync(editor, [...editorArgs, tmpFile], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    if (result.status !== 0) return undefined;
    return fs.readFileSync(tmpFile, "utf-8").replace(/\n$/, "");
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors.
    }
    host.start();
    host.requestRender(true);
  }
}
