#!/usr/bin/env node

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PLATFORM_MAP = {
  linux: "linux",
  darwin: "darwin",
  win32: "windows",
};

const ARCH_MAP = {
  x64: "x64",
  arm64: "arm64",
};

const SUPPORTED = [
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
];

function reportMissingBinary() {
  process.stderr.write(
    `[atomic] No prebuilt binary available for ${process.platform}-${process.arch}.\n` +
      `Supported targets: ${SUPPORTED.join(", ")}.\n` +
      `If you need atomic on this platform, please open an issue at https://github.com/flora131/atomic/issues.\n`
  );
  process.exit(0);
}

const os = PLATFORM_MAP[process.platform];
const cpu = ARCH_MAP[process.arch];

if (!os || !cpu) reportMissingBinary();

try {
  require.resolve(`@bastani/atomic-${os}-${cpu}/package.json`);
  // Found — exit silently.
  process.exit(0);
} catch {
  reportMissingBinary();
}
