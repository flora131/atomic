/** @jsxImportSource @opentui/react */

import type { ConnectorResult } from "./connectors.ts";

export function Edge({ text, col, row, width, height, color: edgeColor }: ConnectorResult) {
  return (
    <box position="absolute" left={col} top={row} width={width} height={height}>
      <text fg={edgeColor}>{text}</text>
    </box>
  );
}
