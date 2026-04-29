const http = require('http');
const https = require('https');

const TARGET_DOMAIN = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");
const SECRET_PATH = "/api/v1/chat/conversation/authenticated";
const PORT = process.env.PORT || 3000;

// هدرهایی که نباید به سرور اصلی ارسال شوند (باعث تداخل می‌شوند)
const STRIP_HEADERS = [
  "host", "connection", "transfer-encoding", "keep-alive", 
  "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade"
];

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

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (isHttps ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {},
      rejectUnauthorized: false 
    };

    // کپی کردن هدرها با فیلتر کردن موارد مخرب
    for (const [key, value] of Object.entries(req.headers)) {
      if (!STRIP_HEADERS.includes(key.toLowerCase()) && !key.toLowerCase().startsWith('cf-')) {
        options.headers[key] = value;
      }
    }

    // هدرهای ضروری برای پروکسی
    options.headers["Host"] = targetUrl.hostname;
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    if (clientIp) {
      options.headers["X-Forwarded-For"] = clientIp.split(',')[0].trim();
    }
    options.headers["X-Forwarded-Proto"] = "https";
    
    // اگر کلاینت Transfer-Encoding: chunked فرستاد، باید آن را حفظ کنیم
    if (req.headers["transfer-encoding"] === "chunked") {
        options.headers["Transfer-Encoding"] = "chunked";
    }

    const proxyReq = requestModule.request(options, (proxyRes) => {
      // پاک کردن هدرهایی که در بازگشت از سرور اصلی مخرب هستند
      const responseHeaders = { ...proxyRes.headers };
      delete responseHeaders["server"];
      delete responseHeaders["x-powered-by"];
      delete responseHeaders["transfer-encoding"]; // در ریسپانس نباید باشد
      delete responseHeaders["connection"];

      res.writeHead(proxyRes.statusCode, responseHeaders);
      
      // پایپ کردن داده‌ها بدون بستن اجباری (مهم برای XHTTP)
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("Upstream Relay Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain" });
        res.end("Bad Gateway");
      }
    });

    // مدیریت خطا در سمت کلاینت
    req.on("error", () => proxyReq.destroy());
    req.on("aborted", () => proxyReq.destroy());

    // ارسال داده‌های کلاینت به سرور
    req.pipe(proxyReq);

  } catch (error) {
    console.error("Internal Server Error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Error");
    }
  }
});

// این خطوط برای جلوگیری از کرش کردن سرور در صورت خطای هندل نشده است
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Railway Relay Service is running on port ${PORT}`);
});
