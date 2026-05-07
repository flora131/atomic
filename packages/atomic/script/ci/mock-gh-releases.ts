#!/usr/bin/env bun
/**
 * Mock GitHub Releases server for `atomic update` CI tests.
 *
 * Serves the two endpoints `release-fetch.ts` hits:
 *   GET /releases/latest          → ReleaseInfo JSON
 *   GET /releases/tags/<tag>      → ReleaseInfo JSON (same content)
 *   GET /asset/<asset-name>       → raw binary bytes
 *   GET /manifest.json            → manifest.json bytes
 *
 * Driven entirely by env vars so the publish.yml step doesn't need to
 * pass shell-quoted JSON:
 *
 *   MOCK_PORT          (default 4874)
 *   MOCK_VERSION       e.g. "0.7.9-update"  (renders as tag "v0.7.9-update")
 *   MOCK_ASSET_DIR     directory containing the atomic-<host>[.exe] files
 *                      (typically packages/atomic/release-assets/)
 *   MOCK_MANIFEST_PATH path to manifest.json (typically MOCK_ASSET_DIR/manifest.json)
 *
 * On startup the server emits "READY <port>\n" to stdout — the calling
 * shell can grep for it before exercising `atomic update`.
 *
 * Designed to run in the background (e.g. `bun … &`) and be killed via
 * SIGTERM at the end of the matrix step.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface MockEnv {
    readonly port: number;
    readonly version: string;
    readonly assetDir: string;
    readonly manifestPath: string;
}

function readEnv(): MockEnv {
    const port = Number(process.env.MOCK_PORT ?? "4874");
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new Error(`MOCK_PORT must be a valid TCP port; got "${process.env.MOCK_PORT}"`);
    }
    const version = process.env.MOCK_VERSION;
    if (!version) throw new Error("MOCK_VERSION env var is required");
    const assetDir = process.env.MOCK_ASSET_DIR;
    if (!assetDir) throw new Error("MOCK_ASSET_DIR env var is required");
    if (!existsSync(assetDir)) throw new Error(`MOCK_ASSET_DIR does not exist: ${assetDir}`);
    const manifestPath = process.env.MOCK_MANIFEST_PATH ?? join(assetDir, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error(`manifest.json not found at: ${manifestPath}`);
    return { port, version, assetDir, manifestPath };
}

function buildReleaseInfo(env: MockEnv, baseUrl: string): unknown {
    // Enumerate every atomic-<target>[.exe] file in the asset dir plus the
    // manifest. The CLI looks up an asset by name, so the set must include
    // the host's binary; including all platforms keeps the mock honest.
    const entries = readdirSync(env.assetDir).filter((name) => {
        if (name === "manifest.json") return false;
        const full = join(env.assetDir, name);
        return statSync(full).isFile();
    });

    const assets = entries.map((name) => ({
        name,
        browser_download_url: `${baseUrl}/asset/${encodeURIComponent(name)}`,
    }));
    assets.push({
        name: "manifest.json",
        browser_download_url: `${baseUrl}/manifest.json`,
    });

    return {
        tag_name: `v${env.version}`,
        assets,
    };
}

function main(): void {
    const env = readEnv();

    const server = Bun.serve({
        port: env.port,
        hostname: "127.0.0.1",
        fetch(req: Request): Response {
            const url = new URL(req.url);
            const path = url.pathname;
            const baseUrl = `http://${url.host}`;

            // GitHub URL shapes — match both "/repos/<owner>/<repo>/releases/..."
            // and bare "/releases/..." since callers can pass either base.
            if (path.endsWith("/releases/latest") || path.includes("/releases/tags/")) {
                return Response.json(buildReleaseInfo(env, baseUrl), {
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (path === "/manifest.json") {
                const bytes = readFileSync(env.manifestPath);
                return new Response(bytes, {
                    headers: { "Content-Type": "application/json" },
                });
            }

            const assetMatch = path.match(/^\/asset\/(.+)$/);
            if (assetMatch?.[1]) {
                const assetName = decodeURIComponent(assetMatch[1]);
                const filePath = join(env.assetDir, assetName);
                if (!existsSync(filePath)) {
                    return new Response(`asset not found: ${assetName}`, { status: 404 });
                }
                return new Response(Bun.file(filePath), {
                    headers: { "Content-Type": "application/octet-stream" },
                });
            }

            return new Response(`not found: ${path}`, { status: 404 });
        },
    });

    process.stdout.write(`READY ${server.port}\n`);

    const shutdown = (): void => {
        server.stop(true);
        process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

main();
