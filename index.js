const http = require('http');
const https = require('https');

const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const SECRET_PATH = "/api/v1/chat/conversation/authenticated";
const PORT = process.env.PORT || 3000;

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "server", "via"
]);

const server = http.createServer((req, res) => {
  if (!TARGET_DOMAIN) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Service Unavailable: TARGET_DOMAIN not configured.");
  }

  if (!req.url.startsWith(SECRET_PATH)) {
    if (req.url === "/" || req.url === "") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!DOCTYPE html><html><head><title>System OK</title></head><body><h1>All Systems Operational</h1></body></html>`);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }

  try {
    const targetUrl = new URL(TARGET_DOMAIN + req.url);
    const isHttps = targetUrl.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {},
      rejectUnauthorized: false 
    };

    let clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();

    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      
      if (STRIP_HEADERS.has(k) || k.startsWith("cf-") || k.startsWith("x-railway-")) continue;

      if (k === "user-agent") {
        options.headers[k] = value || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";
        continue;
      }

      options.headers[k] = value;
    }

    options.headers["Host"] = targetUrl.hostname;
    if (clientIp) options.headers["X-Forwarded-For"] = clientIp;
    options.headers["X-Forwarded-Proto"] = "https";

    const proxyReq = requestModule.request(options, (proxyRes) => {
      const responseHeaders = { ...proxyRes.headers };
      
      delete responseHeaders["server"];
      delete responseHeaders["x-powered-by"];
      delete responseHeaders["via"];
      delete responseHeaders["transfer-encoding"];

      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Upstream Relay Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway");
      }
    });

    req.pipe(proxyReq);

  } catch (error) {
    console.error("Internal Server Error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Error");
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Railway Relay Service is running on port ${PORT}`);
});