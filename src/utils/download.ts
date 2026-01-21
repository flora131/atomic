/**
 * GitHub release and download utilities for atomic updates
 *
 * Provides functions to:
 * - Fetch latest release information from GitHub API
 * - Download files with progress reporting
 * - Verify SHA256 checksums
 * - Get platform-specific filenames for binaries and config archives
 */

import { isWindows } from "./detect";

/** GitHub repository for atomic */
export const GITHUB_REPO = "flora131/atomic";

/** Information about a GitHub release */
export interface ReleaseInfo {
  /** Version string without 'v' prefix (e.g., "0.2.0") */
  version: string;
  /** Full tag name (e.g., "v0.2.0") */
  tagName: string;
  /** ISO date when the release was published */
  publishedAt: string;
  /** Release notes in markdown format */
  body: string;
}

/**
 * Fetch the latest release info from GitHub API.
 *
 * @returns Release information for the latest version
 * @throws Error if the API request fails or rate limit is exceeded
 */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  // Include token if available to avoid rate limits
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "GitHub API rate limit exceeded. Set GITHUB_TOKEN environment variable to increase limit."
      );
    }
    if (response.status === 404) {
      throw new Error("No releases found for this repository.");
    }
    throw new Error(`Failed to fetch release info: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    version: data.tag_name.replace(/^v/, ""),
    tagName: data.tag_name,
    publishedAt: data.published_at,
    body: data.body || "",
  };
}

/**
 * Fetch release info for a specific version from GitHub API.
 *
 * @param version - Version string with or without 'v' prefix (e.g., "0.2.0" or "v0.2.0")
 * @returns Release information for the specified version
 * @throws Error if the version is not found or API request fails
 */
export async function getReleaseByVersion(version: string): Promise<ReleaseInfo> {
  // Ensure version has 'v' prefix for tag lookup
  const tagName = version.startsWith("v") ? version : `v${version}`;
  const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tagName}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        "GitHub API rate limit exceeded. Set GITHUB_TOKEN environment variable to increase limit."
      );
    }
    if (response.status === 404) {
      throw new Error(`Version ${tagName} not found.`);
    }
    throw new Error(`Failed to fetch release info: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    version: data.tag_name.replace(/^v/, ""),
    tagName: data.tag_name,
    publishedAt: data.published_at,
    body: data.body || "",
  };
}

/**
 * Progress callback type for download operations.
 * Called periodically with the download percentage (0-100).
 */
export type ProgressCallback = (percent: number) => void;

/**
 * Download a file from a URL to a local path with optional progress reporting.
 *
 * @param url - The URL to download from
 * @param destPath - The local path to save the file to
 * @param onProgress - Optional callback for progress updates (percentage 0-100)
 * @throws Error if the download fails
 */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;
  let loaded = 0;

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Failed to read response body");
  }

  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunks.push(value);
    loaded += value.length;

    if (onProgress && total > 0) {
      onProgress(Math.round((loaded / total) * 100));
    }
  }

  // Combine chunks and write to file
  const data = new Uint8Array(loaded);
  let position = 0;
  for (const chunk of chunks) {
    data.set(chunk, position);
    position += chunk.length;
  }

  await Bun.write(destPath, data);
}

/**
 * Parse a checksums.txt file content into a map of filename to hash.
 *
 * The format is: "<hash>  <filename>" (two spaces between hash and filename)
 * This is the standard format used by sha256sum command.
 *
 * @param checksumsTxt - Content of the checksums.txt file
 * @returns Map of filename to lowercase hex hash
 */
export function parseChecksums(checksumsTxt: string): Map<string, string> {
  const checksums = new Map<string, string>();
  const lines = checksumsTxt.trim().split("\n");

  for (const line of lines) {
    // Format: "<hash>  <filename>" (two spaces between)
    const match = line.match(/^([a-fA-F0-9]{64})\s{2}(.+)$/);
    if (match) {
      const [, hash, filename] = match;
      checksums.set(filename, hash.toLowerCase());
    }
  }

  return checksums;
}

/**
 * Verify SHA256 checksum of a file against checksums.txt content.
 *
 * @param filePath - Path to the file to verify
 * @param checksumsTxt - Content of checksums.txt file
 * @param expectedFilename - The filename to look up in checksums.txt
 * @returns True if the checksum matches, false otherwise
 * @throws Error if the filename is not found in checksums.txt
 */
export async function verifyChecksum(
  filePath: string,
  checksumsTxt: string,
  expectedFilename: string
): Promise<boolean> {
  const checksums = parseChecksums(checksumsTxt);
  const expectedHash = checksums.get(expectedFilename);

  if (!expectedHash) {
    throw new Error(`No checksum found for ${expectedFilename}`);
  }

  // Calculate actual hash using Bun's crypto
  const file = Bun.file(filePath);
  const data = await file.arrayBuffer();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  const actualHash = hasher.digest("hex");

  return actualHash === expectedHash;
}

/**
 * Get platform-specific binary filename for download.
 *
 * Returns the filename used in GitHub releases, e.g.:
 * - linux-x64: "atomic-linux-x64"
 * - darwin-arm64: "atomic-darwin-arm64"
 * - windows-x64: "atomic-windows-x64.exe"
 *
 * @returns The binary filename for the current platform
 * @throws Error if the platform or architecture is not supported
 */
export function getBinaryFilename(): string {
  const platform = process.platform;
  const arch = process.arch;

  let os: string;
  switch (platform) {
    case "linux":
      os = "linux";
      break;
    case "darwin":
      os = "darwin";
      break;
    case "win32":
      os = "windows";
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  let archStr: string;
  switch (arch) {
    case "x64":
      archStr = "x64";
      break;
    case "arm64":
      archStr = "arm64";
      break;
    default:
      throw new Error(`Unsupported architecture: ${arch}`);
  }

  const ext = platform === "win32" ? ".exe" : "";
  return `atomic-${os}-${archStr}${ext}`;
}

/**
 * Get platform-specific config archive filename.
 *
 * Returns:
 * - Unix (Linux/macOS): "atomic-config.tar.gz"
 * - Windows: "atomic-config.zip"
 *
 * @returns The config archive filename for the current platform
 */
export function getConfigArchiveFilename(): string {
  return isWindows() ? "atomic-config.zip" : "atomic-config.tar.gz";
}

/**
 * Build a download URL for a specific version and asset from GitHub releases.
 *
 * @param version - Version tag (should include 'v' prefix, e.g., "v0.1.0")
 * @param filename - The asset filename to download
 * @returns The full download URL
 */
export function getDownloadUrl(version: string, filename: string): string {
  // Ensure version has 'v' prefix
  const tag = version.startsWith("v") ? version : `v${version}`;
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${filename}`;
}

/**
 * Get the URL for the checksums.txt file for a specific version.
 *
 * @param version - Version tag (with or without 'v' prefix)
 * @returns The download URL for checksums.txt
 */
export function getChecksumsUrl(version: string): string {
  return getDownloadUrl(version, "checksums.txt");
}
