/** @jsxImportSource @opentui/react */
/**
 * Internal command that renders the attached-mode footer inside an agent's
 * tmux window. The executor splits each agent window after creation and
 * runs `atomic _footer --name <window-name>` in the bottom pane.
 *
 * The process blocks indefinitely — tmux kills the pane when the workflow
 * session is torn down.
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { resolveTheme } from "../../sdk/runtime/theme.ts";
import { deriveGraphTheme } from "../../sdk/components/graph-theme.ts";
import { AttachedStatusline } from "../../sdk/components/attached-statusline.tsx";

export async function footerCommand(name: string): Promise<number> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });
  const theme = deriveGraphTheme(resolveTheme(renderer.themeMode));
  createRoot(renderer).render(
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      justifyContent="flex-end"
      backgroundColor={theme.background}
    >
      <AttachedStatusline name={name} theme={theme} />
    </box>,
  );

  await new Promise<void>(() => {});
  return 0;
}
