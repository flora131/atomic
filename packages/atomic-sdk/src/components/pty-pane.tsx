/** @jsxImportSource @opentui/react */
/**
 * PtyPane — renders a stage's PTY scrollback and forwards focused keystrokes
 * to the daemon via `pane/sendInput`.
 *
 * §5.4 of specs/2026-05-09-ui-server-bun-native.md
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useKeyboard } from "@opentui/react";
import type { ScrollBoxRenderable } from "@opentui/core";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { PaneOutputNotificationParams } from "../runtime/ui-protocol/schemas.ts";
import { useLatest } from "./hooks.ts";

// ---------------------------------------------------------------------------
// Pure helpers (extracted for unit-testing)
// ---------------------------------------------------------------------------

/**
 * Append newly-arrived PTY output to the existing scrollback buffer.
 *
 * Returns the merged string. If `offset` is less than `headOffset`, the
 * incoming data overlaps already-seen output so only the new tail is
 * appended. If `offset` equals `headOffset`, the data is concatenated in
 * full. If `offset` is greater, a gap marker is inserted to signal that
 * bytes were missed (e.g. during reconnect).
 *
 * Pure function — no side effects, fully unit-testable.
 *
 * @param existing   Current scrollback content.
 * @param headOffset Number of bytes already present at the head of the buffer.
 * @param incoming   New data string from the `pane/output` notification.
 * @param offset     Byte offset at which `incoming` begins in the stream.
 * @returns          `{ content: string; headOffset: number }` — the new
 *                   merged buffer and the updated head offset.
 */
export function appendScrollback(
  existing: string,
  headOffset: number,
  incoming: string,
  offset: number,
): { content: string; headOffset: number } {
  if (incoming.length === 0) {
    return { content: existing, headOffset };
  }

  const incomingEnd = offset + incoming.length;

  if (incomingEnd <= headOffset) {
    // Entirely within already-seen range — discard.
    return { content: existing, headOffset };
  }

  if (offset < headOffset) {
    // Partial overlap — skip the bytes we already have.
    const tail = incoming.slice(headOffset - offset);
    return { content: existing + tail, headOffset: headOffset + tail.length };
  }

  if (offset > headOffset) {
    // Gap — bytes were missed between headOffset and offset.
    const gap = `\r\n[…${offset - headOffset} bytes missing…]\r\n`;
    return {
      content: existing + gap + incoming,
      headOffset: incomingEnd,
    };
  }

  // offset === headOffset — normal contiguous append.
  return { content: existing + incoming, headOffset: incomingEnd };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PtyPaneProps {
  runId: string;
  stageName: string;
  /** When true, keystrokes are forwarded to the daemon via pane/sendInput. */
  focused: boolean;
  connection: MessageConnection;
  /** Width of the pane. Defaults to "100%". */
  width?: number | "auto" | `${number}%`;
  /** Height of the pane. Defaults to "100%". */
  height?: number | "auto" | `${number}%`;
}

/**
 * Renders a stage's PTY scrollback and optionally forwards keystrokes.
 *
 * - On mount: fetches the initial scrollback via `pane/getScrollback`.
 * - Live updates: listens for `pane/output` notifications and appends data.
 * - When `focused`: forwards non-quit keystrokes via `pane/sendInput`.
 * - Scrolls to the bottom on new data unless the user has scrolled up.
 */
export function PtyPane({
  runId,
  stageName,
  focused,
  connection,
  width = "100%",
  height = "100%",
}: PtyPaneProps) {
  const [scrollback, setScrollback] = useState<string>("");
  const [headOffset, setHeadOffset] = useState<number>(0);
  const [userScrolled, setUserScrolled] = useState<boolean>(false);

  // Keep a ref to `scrollback` and `headOffset` so the notification handler
  // (which closes over the initial values) always reads the latest state.
  const scrollbackRef = useLatest(scrollback);
  const headOffsetRef = useLatest(headOffset);
  const userScrolledRef = useLatest(userScrolled);

  // Ref to the scrollbox so we can imperatively scroll to the bottom.
  const scrollboxRef = useRef<ScrollBoxRenderable | null>(null);

  // ── Fetch initial scrollback + register notification handler ─────────────
  useEffect(() => {
    let disposed = false;

    // Fetch initial scrollback.
    (async () => {
      try {
        const result = (await connection.sendRequest("pane/getScrollback", {
          runId,
          stageName,
        })) as { data: string; headOffset: number };

        if (!disposed) {
          setScrollback(result.data);
          setHeadOffset(result.headOffset);
          // Scroll to bottom after loading initial content.
          const sb = scrollboxRef.current;
          if (sb) sb.scrollTo(Number.MAX_SAFE_INTEGER);
        }
      } catch {
        // Non-fatal — pane may not exist yet or scrollback unavailable.
      }
    })();

    // Register live output notification handler.
    const disposable = connection.onNotification(
      "pane/output",
      (params: PaneOutputNotificationParams) => {
        if (params.runId !== runId || params.stageName !== stageName) return;

        const merged = appendScrollback(
          scrollbackRef.current,
          headOffsetRef.current,
          params.data,
          params.offset,
        );

        setScrollback(merged.content);
        setHeadOffset(merged.headOffset);

        // Auto-scroll to bottom unless the user has manually scrolled up.
        if (!userScrolledRef.current) {
          const sb = scrollboxRef.current;
          if (sb) sb.scrollTo(Number.MAX_SAFE_INTEGER);
        }
      },
    );

    return () => {
      disposed = true;
      disposable.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, stageName, connection]);

  // ── Keyboard forwarding ──────────────────────────────────────────────────
  const focusedRef = useLatest(focused);

  const handleScroll = useCallback((delta: number) => {
    const sb = scrollboxRef.current;
    if (!sb) return;
    const next = Math.max(0, sb.scrollTop + delta);
    setUserScrolled(next > 0);
    sb.scrollTo(next);
  }, []);

  useKeyboard((key) => {
    // Don't intercept global quit keys — the parent panel handles those.
    if (key.name === "q" || (key.ctrl && key.name === "c")) return;

    if (!focusedRef.current) return;

    // Scroll with arrow keys / PageUp / PageDown when focused.
    if (key.name === "up") {
      handleScroll(-1);
      return;
    }
    if (key.name === "down") {
      handleScroll(1);
      return;
    }
    if (key.name === "pageup") {
      handleScroll(-10);
      return;
    }
    if (key.name === "pagedown") {
      handleScroll(10);
      return;
    }

    // Forward all other keystrokes to the remote PTY.
    connection
      .sendRequest("pane/sendInput", { runId, stageName, data: key.sequence })
      .catch(() => {
        // Fire-and-forget — ignore errors (pane may have exited).
      });
  });

  return (
    <scrollbox
      ref={scrollboxRef}
      scrollY
      width={width}
      height={height}
    >
      <text>{scrollback}</text>
    </scrollbox>
  );
}
