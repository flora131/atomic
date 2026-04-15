/**
 * Bun-based dev server for the preview directory.
 *
 * Features:
 * - Serves static files from preview/ (for index.html) and project root (for src/ CSS/JS)
 * - Live reload via Server-Sent Events (SSE)
 * - Watches src/ and preview/ directories for changes
 * - Injects live-reload script into HTML responses
 * - Correct MIME types for .html, .css, .js, .json
 * - Handles 404s gracefully
 */

import { join, extname, resolve } from "path";
import { watch as fsWatch } from "fs";

const ROOT = resolve(import.meta.dir, "..");
const PREVIEW_DIR = import.meta.dir;
const SRC_DIR = join(ROOT, "src");

/**
 * Returns the correct MIME type string for a given file extension.
 * @param {string} ext - The file extension including the dot (e.g., ".html")
 * @returns {string} The MIME type string
 */
export function getMimeType(ext) {
  const mimeTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".txt": "text/plain",
    ".xml": "application/xml",
    ".webp": "image/webp",
  };
  return mimeTypes[ext] ?? "application/octet-stream";
}

/**
 * The live-reload client script injected into HTML responses.
 * Connects to the SSE endpoint and reloads the page on "reload" events.
 */
const LIVE_RELOAD_SCRIPT = `
<script>
(function() {
  var es = new EventSource('/__livereload');
  es.addEventListener('reload', function() {
    window.location.reload();
  });
  es.onerror = function() {
    // Reconnect if connection drops
    setTimeout(function() {
      window.location.reload();
    }, 1000);
  };
})();
</script>`;

/**
 * Set of active SSE response controllers.
 * When a file changes, we send a "reload" event to all connected clients.
 * @type {Set<ReadableStreamDefaultController>}
 */
const sseClients = new Set();

/**
 * Injects the live-reload script before </body> (or at end of HTML).
 * @param {string} html - The original HTML content
 * @returns {string} HTML with live-reload script injected
 */
function injectLiveReloadScript(html) {
  if (html.includes("</body>")) {
    return html.replace("</body>", LIVE_RELOAD_SCRIPT + "</body>");
  }
  return html + LIVE_RELOAD_SCRIPT;
}

/**
 * Notifies all connected SSE clients to reload.
 */
function notifyClients() {
  const message = "event: reload\ndata: {}\n\n";
  const encoded = new TextEncoder().encode(message);
  for (const controller of sseClients) {
    try {
      controller.enqueue(encoded);
    } catch {
      sseClients.delete(controller);
    }
  }
}

/**
 * Resolves the file path for a given request URL.
 * - "/" maps to preview/index.html
 * - "/src/..." maps to ROOT/src/...
 * - Everything else maps to preview/...
 * @param {string} pathname - The URL pathname
 * @returns {string} The resolved file system path
 */
function resolveFilePath(pathname) {
  if (pathname === "/" || pathname === "") {
    return join(PREVIEW_DIR, "index.html");
  }

  // Serve src/ files from the project root
  if (pathname.startsWith("/src/")) {
    return join(ROOT, pathname);
  }

  // Everything else is served from preview/
  return join(PREVIEW_DIR, pathname);
}

/**
 * Handles an incoming HTTP request.
 * @param {Request} req - The incoming request
 * @returns {Promise<Response>} The response
 */
async function handleRequest(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // SSE live reload endpoint
  if (pathname === "/__livereload") {
    let controller;
    const stream = new ReadableStream({
      start(ctrl) {
        controller = ctrl;
        sseClients.add(ctrl);
        // Send an initial comment as keep-alive
        ctrl.enqueue(new TextEncoder().encode(": connected\n\n"));
        // Send retry hint
        ctrl.enqueue(new TextEncoder().encode("retry: 5000\n\n"));
      },
      cancel() {
        sseClients.delete(controller);
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const filePath = resolveFilePath(pathname);

  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      return new Response("404 Not Found: " + pathname, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const ext = extname(filePath).toLowerCase();
    const mimeType = getMimeType(ext);

    // Inject live-reload script into HTML responses
    if (ext === ".html") {
      const text = await file.text();
      const injected = injectLiveReloadScript(text);
      return new Response(injected, {
        status: 200,
        headers: { "Content-Type": mimeType },
      });
    }

    return new Response(file, {
      status: 200,
      headers: { "Content-Type": mimeType },
    });
  } catch (err) {
    return new Response("500 Internal Server Error", {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

/**
 * Starts a file watcher on a directory. On any change, notifies SSE clients.
 * Uses Bun's Node.js-compatible fs.watch API (recursive option).
 * @param {string} dir - The directory to watch
 * @returns {import("fs").FSWatcher | null} The watcher instance, or null if unavailable
 */
function watchDirectory(dir) {
  try {
    const watcher = fsWatch(dir, { recursive: true }, (_event, _filename) => {
      notifyClients();
    });
    return watcher;
  } catch {
    // Silent fallback if the directory does not exist or watching is unavailable
    return null;
  }
}

/**
 * Creates and starts the dev server.
 * @param {{ port?: number }} [options] - Server options
 * @returns {ReturnType<typeof Bun.serve>} The Bun server instance
 */
export function createServer(options = {}) {
  const port = options.port ?? parseInt(process.env.PORT ?? "3000", 10);

  // Watch src/ and preview/ for changes
  watchDirectory(SRC_DIR);
  watchDirectory(PREVIEW_DIR);

  const server = Bun.serve({
    port,
    fetch: handleRequest,
  });

  return server;
}

// When run directly (not imported as a module), start the server
if (import.meta.main) {
  const port = parseInt(process.env.PORT ?? "3000", 10);
  const server = createServer({ port });
  console.log(`Dev server running at http://localhost:${server.port}`);
  console.log(`Watching src/ and preview/ for changes...`);
  console.log(`Press Ctrl+C to stop.`);

  // Keep the process alive
  process.on("SIGINT", () => {
    server.stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}
