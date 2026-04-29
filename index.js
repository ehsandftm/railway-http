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
    const isHttps = targetUrl.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    // کپی کردن تمام هدرها بدون دستکاری برای حفظ یکپارچگی استریم XHTTP
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: { ...req.headers },
      rejectUnauthorized: false 
    };

    // فقط هدر Host را برای فایروال سرور مقصد تغییر می‌دهیم
    options.headers["Host"] = targetUrl.hostname;

    const proxyReq = requestModule.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", (err) => {
      console.error("Upstream Relay Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway");
      }
    });

    // مدیریت قطع شدن ناگهانی کلاینت برای جلوگیری از کرش کردن سرور
    req.on("error", () => proxyReq.destroy());
    req.on("aborted", () => proxyReq.destroy());

    // انتقال جریان داده‌ها به سرور اصلی
    req.pipe(proxyReq, { end: true });

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
