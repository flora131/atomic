import { join } from "path";
import { homedir } from "os";
import { CONFIG_DIR_NAME } from "@bastani/atomic";

function sanitizePipeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "default";
}

export function getBrokerSocketPath(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = homedir(),
): string {
  if (platform === "win32") {
    return `\\\\.\\pipe\\pi-intercom-${sanitizePipeSegment(homeDir)}`;
  }

  return join(homeDir, CONFIG_DIR_NAME, "agent", "intercom", "broker.sock");
}
