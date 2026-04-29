const http = require('http');
const https = require('https');

const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const SECRET_PATH = "/api/v1/chat/conversation/authenticated";
const PORT = process.env.PORT || 3000;

// ساخت یک Agent اختصاصی برای جلوگیری از قطع شدن استریم‌ها و تایم‌اوت
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000,
  timeout: 60000,
  rejectUnauthorized: false
});

const server = http.createServer((req, res) => {
  if (!TARGET_DOMAIN) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    return res.end("Service Unavailable: TARGET_DOMAIN not configured.");
  }

  // مخفی‌سازی مسیر
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
    
    // کانفیگ درخواست به سمت سرور اصلی شما
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      agent: httpsAgent,
      headers: {}
    };

    // کپی کردن هدرها و اضافه کردن هدرهای حیاتی برای گول زدن فایروال
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (k !== 'host' && k !== 'connection' && k !== 'keep-alive') {
        options.headers[k] = value;
      }
    }

    options.headers["Host"] = targetUrl.hostname;
    // اجبار به استفاده از Connection: keep-alive برای زنده نگه داشتن XHTTP
    options.headers["Connection"] = "keep-alive";
    
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    if (clientIp) options.headers["X-Forwarded-For"] = clientIp.split(',')[0].trim();
    options.headers["X-Forwarded-Proto"] = "https";

    const proxyReq = https.request(options, (proxyRes) => {
      const resHeaders = { ...proxyRes.headers };
      delete resHeaders["server"];
      delete resHeaders["x-powered-by"];

      res.writeHead(proxyRes.statusCode, resHeaders);
      res.flushHeaders(); 
      proxyRes.pipe(res);
    });

    // مدیریت خطای تایم‌اوت و 502 که در لاگ‌ها داشتی
    proxyReq.on("error", (err) => {
      console.error("Upstream Error:", err.message);
      if (!res.headersSent) {
        // اگر خطای تایم‌اوت داد، 504 برگردان تا فرقش با 502 مشخص شود
        res.writeHead(err.code === 'ETIMEDOUT' ? 504 : 502, { "Content-Type": "text/plain" });
        res.end("Gateway Error: " + err.message);
      }
    });

    req.on("error", () => proxyReq.destroy());
    req.on("aborted", () => proxyReq.destroy());

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
