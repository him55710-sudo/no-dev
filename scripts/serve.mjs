import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  process.argv.includes("--site") ? "../release/site" : "../dist",
);
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
};
try {
  await stat(path.join(root, "index.html"));
} catch {
  console.error(process.argv.includes("--site")
    ? "Site package missing. Run pnpm build and pnpm pages:package first."
    : "Build missing. Run pnpm install and pnpm build first.");
  process.exit(1);
}
const server = http.createServer(async (req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://127.0.0.1").pathname,
    );
    let target = path.resolve(root, "." + pathname);
    if (target !== root && !target.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!path.extname(target)) target = path.join(root, "index.html");
    const data = await readFile(target);
    res.writeHead(200, {
      "Content-Type": types[path.extname(target)] || "application/octet-stream",
      "Cache-Control": target.includes(path.sep + "assets" + path.sep)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Already running or port in use. Open http://127.0.0.1:${port}/`
      : error.message,
  );
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  const actualPort = server.address().port;
  console.log(`Pureobom is ready: http://127.0.0.1:${actualPort}/`);
  console.log(
    `System design walkthrough: http://127.0.0.1:${actualPort}/workspace-demo.html`,
  );
  console.log("Keep this window open. Press Ctrl+C to stop.");
});
