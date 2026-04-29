import http from 'node:http';

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const PORT = process.env.PORT || 3000;
const SECRET_PATH = "/api/v1/chat/conversation/authenticated";

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "server", "x-powered-by", "via"
]);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!TARGET_BASE) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Service Unavailable - TARGET_DOMAIN not set");
  }

  if (!url.pathname.startsWith(SECRET_PATH)) {
    if (url.pathname === "/" || url.pathname === "") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!DOCTYPE html><html lang="fa"><head><meta charset="utf-8"><title>Service</title></head><body><h1>Service Running</h1><p>Authentication required.</p></body></html>`);
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not Found");
  }

  try {
    const targetUrl = `${TARGET_BASE}${url.pathname}${url.search}`;

    const headers = {};
    let clientIp = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();

    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k)) continue;

      if (k === "user-agent") {
        headers[key] = value || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
        continue;
      }
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    if (clientIp) headers["x-forwarded-for"] = clientIp;
    headers["x-forwarded-proto"] = "https";

    const hasBody = req.method !== "GET" && req.method !== "HEAD";

    const fetchOptions = {
      method: req.method,
      headers: headers,
      redirect: "manual",
    };

    if (hasBody) {
      // روش بهتر برای Railway / Node.js
      fetchOptions.body = req;
      fetchOptions.duplex = "half";
    }

    const upstream = await fetch(targetUrl, fetchOptions);

    // کپی هدرها
    res.writeHead(upstream.status || 502, Object.fromEntries(upstream.headers.entries()));

    // حذف هدرهای شناسایی‌کننده
    res.removeHeader("server");
    res.removeHeader("x-powered-by");
    res.removeHeader("via");

    // Streaming پاسخ
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
    }
    res.end();

  } catch (err) {
    console.error("Relay Error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway");
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ XHTTP Relay listening on port ${PORT}`);
});
