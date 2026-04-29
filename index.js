import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PORT = process.env.PORT || 3000;
const SECRET_PATH = "/api/v1/chat/conversation/authenticated";

const STRIP_REQ_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "via"
]);

const STRIP_RES_HEADERS = new Set([
  "server", "x-powered-by", "via", "transfer-encoding", "connection"
]);

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain" });
    return res.end("Bad Request");
  }

  // Health check
  if (url.pathname === "/" || url.pathname === "") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(`<!DOCTYPE html><html lang="fa"><head><meta charset="utf-8"><title>Service</title></head><body><h1>Service Running</h1><p>Authentication required.</p></body></html>`);
  }

  if (!TARGET_BASE) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Service Unavailable - TARGET_DOMAIN not set");
  }

  if (!url.pathname.startsWith(SECRET_PATH)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }

  // Build target URL
  let targetUrl;
  try {
    targetUrl = new URL(`${TARGET_BASE}${url.pathname}${url.search}`);
  } catch {
    res.writeHead(502, { "Content-Type": "text/plain" });
    return res.end("Bad Gateway - Invalid target URL");
  }

  // Build forwarded headers
  const outHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const k = key.toLowerCase();
    if (STRIP_REQ_HEADERS.has(k)) continue;
    outHeaders[k] = Array.isArray(value) ? value.join(", ") : value;
  }

  const clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress;
  if (clientIp) outHeaders["x-forwarded-for"] = clientIp;
  outHeaders["x-forwarded-proto"] = "https";
  outHeaders["host"] = targetUrl.host;

  const isHttps = targetUrl.protocol === "https:";
  const lib = isHttps ? https : http;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (isHttps ? 443 : 80),
    path: `${targetUrl.pathname}${targetUrl.search}`,
    method: req.method,
    headers: outHeaders,
    timeout: 30000,
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    // Clean response headers
    const resHeaders = {};
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      const k = key.toLowerCase();
      if (STRIP_RES_HEADERS.has(k)) continue;
      resHeaders[k] = value;
    }

    res.writeHead(proxyRes.statusCode || 502, resHeaders);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('timeout', () => {
    console.error("Relay Error: upstream request timed out");
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { "Content-Type": "text/plain" });
      res.end("Gateway Timeout");
    }
  });

  proxyReq.on('error', (err) => {
    console.error("Relay Error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway - Tunnel Failed");
    }
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ XHTTP Relay is running on port ${PORT}`);
  console.log(`TARGET_BASE: ${TARGET_BASE}`);
});
