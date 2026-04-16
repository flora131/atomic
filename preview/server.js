/**
 * Bun static file server for local preview.
 *
 * Serves index.html for all routes (hash routing — no server-side routing needed).
 * Serves /src/** and other static assets from the project root.
 *
 * Usage:
 *   bun preview/server.js
 *
 * Runs at http://localhost:3000
 */

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const ROOT = new URL("..", import.meta.url).pathname;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * @param {string} filePath
 * @returns {string}
 */
function getMimeType(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return mimeTypes[ext] ?? "application/octet-stream";
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let pathname = url.pathname;

    // Normalize root
    if (pathname === "/") pathname = "/index.html";

    // Resolve to file system path
    const filePath = ROOT + pathname.replace(/^\//, "");

    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (exists) {
      return new Response(file, {
        headers: {
          "Content-Type": getMimeType(filePath),
          "Cache-Control": "no-cache",
        },
      });
    }

    // SPA fallback — all unmatched paths serve index.html (hash routing handles the rest)
    const indexFile = Bun.file(ROOT + "index.html");
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  },
});

console.log(`Preview server running at http://localhost:${PORT}`);
console.log(`Serving from: ${ROOT}`);
