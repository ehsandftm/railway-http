const http = require('http');
const https = require('https');

const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const SECRET_PATH = "/api/v1/chat/conversation/authenticated";
const PORT = process.env.PORT || 3000;

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

    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      // هدر Transfer-Encoding نباید حذف شود تا استریم حفظ شود
      if (k === 'host' || k === 'connection' || k === 'keep-alive' || k.startsWith('cf-')) {
        continue;
      }
      options.headers[k] = value;
    }

    options.headers["Host"] = targetUrl.hostname;
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    if (clientIp) options.headers["X-Forwarded-For"] = clientIp.split(',')[0].trim();
    options.headers["X-Forwarded-Proto"] = "https";

    const proxyReq = requestModule.request(options, (proxyRes) => {
      const resHeaders = { ...proxyRes.headers };
      delete resHeaders["server"];
      delete resHeaders["x-powered-by"];
      delete resHeaders["connection"];

      res.writeHead(proxyRes.statusCode, resHeaders);
      
      // کاتالیزور اول: شلیک فوری هدرهای پاسخ به سمت کلاینت V2ray
      res.flushHeaders(); 
      
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Upstream Relay Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway");
      }
    });

    req.on("error", () => proxyReq.destroy());
    req.on("aborted", () => proxyReq.destroy());

    // کاتالیزور دوم (مهم‌ترین خط برای XHTTP): 
    // شلیک فوری هدرهای درخواست به سمت سرور مقصد (شکستن قفل Deadlock)
    proxyReq.flushHeaders();

    req.pipe(proxyReq);

  } catch (error) {
    console.error("Internal Server Error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Error");
    }
  }
});

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Railway Relay Service is running on port ${PORT}`);
});