import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exec } from "node:child_process";

const PORT = 3000;
const ROOT = process.cwd();
const portalOut = path.join(ROOT, "portal", "out");
const docsBuild = path.join(ROOT, "docs", "build");
const launcherDist = path.join(ROOT, "launcher", "dist");
const packagesDir = path.join(ROOT, "packages");
const catalogFile = path.join(ROOT, "catalog", "apps.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ps1": "text/plain; charset=utf-8",
};

function readBodyBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function readBody(req) {
  return readBodyBuffer(req).then((buf) => buf.toString("utf8"));
}

function extractMultipartFileBuffer(rawBuf, contentType) {
  const bMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  if (!bMatch) return null;
  const boundary = bMatch[1] || bMatch[2];
  const delim = Buffer.from(`--${boundary}`);
  const headerSep = Buffer.from("\r\n\r\n");

  let pos = rawBuf.indexOf(delim);
  while (pos !== -1) {
    const partStart = pos + delim.length;
    if (rawBuf.slice(partStart, partStart + 2).equals(Buffer.from("--"))) break;
    const nextPos = rawBuf.indexOf(delim, partStart);
    if (nextPos === -1) break;

    const part = rawBuf.slice(partStart, nextPos);
    const sepIdx = part.indexOf(headerSep);
    if (sepIdx !== -1) {
      const headersText = part.slice(0, sepIdx).toString("utf8");
      if (/filename=/i.test(headersText)) {
        let body = part.slice(sepIdx + headerSep.length);
        if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a) {
          body = body.slice(0, body.length - 2);
        }
        return body;
      }
    }
    pos = nextPos;
  }
  return null;
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-filename, X-Filename",
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function sanitizeFilename(rawName) {
  if (!rawName || typeof rawName !== "string") return "";
  let decoded = rawName;
  try {
    decoded = decodeURIComponent(rawName);
  } catch {
    decoded = rawName;
  }
  const base = path.basename(decoded.replace(/\\/g, "/"));
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  if (!safe || safe === "." || safe === "..") return "";
  return safe;
}

function resolveFile(baseDir, relPath) {
  const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, "");
  let fullPath = path.join(baseDir, safeRel);
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    const indexHtml = path.join(fullPath, "index.html");
    if (fs.existsSync(indexHtml)) return indexHtml;
  }
  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
    return fullPath;
  }
  if (!path.extname(fullPath)) {
    const withHtml = `${fullPath}.html`;
    if (fs.existsSync(withHtml)) return withHtml;
    const withIndex = path.join(fullPath, "index.html");
    if (fs.existsSync(withIndex)) return withIndex;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);
  const apiPath = pathname.startsWith("/AllSoftDesktop/api/")
    ? pathname.slice("/AllSoftDesktop".length)
    : pathname;

  if (req.method === "OPTIONS" && apiPath.startsWith("/api/")) {
    sendJson(res, 200, { ok: true });
    return;
  }

  // GET /api/catalog -> trả nội dung tươi nhất của catalog/apps.json
  if (req.method === "GET" && apiPath === "/api/catalog") {
    try {
      const content = fs.readFileSync(catalogFile, "utf8");
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(content);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  // POST /api/save-catalog -> ghi vào catalog/apps.json và portal/out/apps.json (nếu có)
  if (req.method === "POST" && apiPath === "/api/save-catalog") {
    try {
      const raw = await readBody(req);
      const parsed = JSON.parse(raw);
      const payloadObj =
        parsed && typeof parsed === "object" && parsed.catalog && Array.isArray(parsed.catalog.apps)
          ? parsed.catalog
          : parsed;
      const formatted = JSON.stringify(payloadObj, null, 2) + "\n";
      fs.mkdirSync(path.dirname(catalogFile), { recursive: true });
      fs.writeFileSync(catalogFile, formatted, "utf8");

      const portalPublicCatalog = path.join(ROOT, "portal", "public", "apps.json");
      if (fs.existsSync(path.dirname(portalPublicCatalog))) {
        fs.writeFileSync(portalPublicCatalog, formatted, "utf8");
      }
      if (fs.existsSync(portalOut)) {
        fs.writeFileSync(path.join(portalOut, "apps.json"), formatted, "utf8");
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  // POST /api/upload-logo -> giải mã base64 ghi đè vào các thư mục logo.png
  if (req.method === "POST" && apiPath === "/api/upload-logo") {
    try {
      const raw = await readBody(req);
      const { dataUrl } = JSON.parse(raw);
      if (!dataUrl || typeof dataUrl !== "string") {
        sendJson(res, 400, { ok: false, error: "Thiếu dữ liệu dataUrl" });
        return;
      }
      const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
      const base64Data = match ? match[1] : dataUrl.replace(/^data:.*;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const targets = [
        path.join(ROOT, "portal", "public", "logo.png"),
        path.join(ROOT, "portal", "out", "logo.png"),
        path.join(ROOT, "docs", "static", "img", "logo.png"),
        path.join(ROOT, "launcher", "public", "logo.png"),
        path.join(ROOT, "launcher", "dist", "logo.png"),
      ];

      for (const target of targets) {
        const dir = path.dirname(target);
        if (target.includes(path.join("portal", "out")) || target.includes(path.join("launcher", "dist"))) {
          if (!fs.existsSync(dir)) continue;
        } else {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target, buffer);
      }

      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  // POST /api/upload-icon -> giải mã base64 (JSON { dataUrl }) hoặc multipart/form-data ghi đè vào các thư mục icon.png
  if (req.method === "POST" && apiPath === "/api/upload-icon") {
    try {
      const contentType = String(req.headers["content-type"] || "");
      let buffer = null;

      if (contentType.toLowerCase().includes("multipart/form-data")) {
        const rawBuf = await readBodyBuffer(req);
        buffer = extractMultipartFileBuffer(rawBuf, contentType);
        if (!buffer || buffer.length === 0) {
          sendJson(res, 400, { ok: false, error: "Không tìm thấy dữ liệu ảnh trong biểu mẫu multipart" });
          return;
        }
      } else {
        const raw = await readBody(req);
        const { dataUrl } = JSON.parse(raw);
        if (!dataUrl || typeof dataUrl !== "string") {
          sendJson(res, 400, { ok: false, error: "Thiếu dữ liệu dataUrl" });
          return;
        }
        const match = dataUrl.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
        const base64Data = match ? match[1] : dataUrl.replace(/^data:.*;base64,/, "");
        buffer = Buffer.from(base64Data, "base64");
      }

      const targets = [
        path.join(ROOT, "portal", "public", "icon.png"),
        path.join(ROOT, "portal", "out", "icon.png"),
        path.join(ROOT, "docs", "static", "img", "icon.png"),
        path.join(ROOT, "launcher", "public", "icon.png"),
        path.join(ROOT, "launcher", "dist", "icon.png"),
      ];

      for (const target of targets) {
        const dir = path.dirname(target);
        if (target.includes(path.join("portal", "out")) || target.includes(path.join("launcher", "dist"))) {
          if (!fs.existsSync(dir)) continue;
        } else {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(target, buffer);
      }

      sendJson(res, 200, { ok: true, url: "/AllSoftDesktop/icon.png" });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  // POST /api/upload-installer -> stream file cài đặt lớn trực tiếp xuống packages/ và tính SHA256
  if (req.method === "POST" && apiPath === "/api/upload-installer") {
    const headerFilename = req.headers["x-filename"];
    const queryFilename = urlObj.searchParams.get("filename");
    const rawName = Array.isArray(headerFilename)
      ? headerFilename[0]
      : headerFilename || queryFilename || "";
    const safeFilename = sanitizeFilename(rawName);

    if (!safeFilename) {
      sendJson(res, 400, {
        ok: false,
        error: "Tên file không hợp lệ hoặc bị thiếu (dùng header x-filename hoặc query ?filename=...)",
      });
      return;
    }

    try {
      fs.mkdirSync(packagesDir, { recursive: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err?.message || err) });
      return;
    }

    const targetPath = path.join(packagesDir, safeFilename);
    const hash = crypto.createHash("sha256");
    let totalBytes = 0;
    let settled = false;

    const writeStream = fs.createWriteStream(targetPath);

    const cleanupPartial = () => {
      try {
        if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      } catch {
        // bỏ qua lỗi dọn file tạm
      }
    };

    const failUpload = (status, errMsg) => {
      if (settled) return;
      settled = true;
      writeStream.destroy();
      cleanupPartial();
      if (!res.writableEnded) {
        sendJson(res, status, { ok: false, error: errMsg });
      }
    };

    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      hash.update(chunk);
    });

    req.on("error", (err) => {
      failUpload(500, String(err?.message || err));
    });

    req.on("aborted", () => {
      failUpload(499, "Upload bị hủy giữa chừng");
    });

    writeStream.on("error", (err) => {
      failUpload(500, String(err?.message || err));
    });

    writeStream.on("finish", () => {
      if (settled) return;
      settled = true;
      const hashHex = hash.digest("hex");
      sendJson(res, 200, {
        ok: true,
        filename: safeFilename,
        size: totalBytes,
        sha256: hashHex,
        localUrl: "/AllSoftDesktop/packages/" + encodeURIComponent(safeFilename),
      });
    });

    req.pipe(writeStream);
    return;
  }

  // GET /api/packages -> liệt kê các file bộ cài đang có trong packages/
  if (req.method === "GET" && apiPath === "/api/packages") {
    try {
      fs.mkdirSync(packagesDir, { recursive: true });
      const entries = fs.readdirSync(packagesDir, { withFileTypes: true });
      const packages = entries
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const fullPath = path.join(packagesDir, entry.name);
          const stat = fs.statSync(fullPath);
          return {
            filename: entry.name,
            size: stat.size,
            localUrl: "/AllSoftDesktop/packages/" + encodeURIComponent(entry.name),
            updatedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => a.filename.localeCompare(b.filename));

      sendJson(res, 200, { ok: true, packages }, {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: String(err?.message || err) });
    }
    return;
  }

  if (pathname === "/" || pathname === "/AllSoftDesktop") {
    res.writeHead(302, { Location: "/AllSoftDesktop/" });
    res.end();
    return;
  }

  // GET /AllSoftDesktop/packages/<filename> và /packages/<filename> -> tải file trực tiếp từ packages/
  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (pathname.startsWith("/AllSoftDesktop/packages/") || pathname.startsWith("/packages/"))
  ) {
    const rel = pathname.startsWith("/AllSoftDesktop/packages/")
      ? pathname.slice("/AllSoftDesktop/packages/".length)
      : pathname.slice("/packages/".length);
    const safeRel = path.basename(rel.replace(/\\/g, "/"));
    const pkgPath = safeRel ? path.join(packagesDir, safeRel) : "";

    if (
      !safeRel ||
      !pkgPath.startsWith(packagesDir + path.sep) ||
      !fs.existsSync(pkgPath) ||
      !fs.statSync(pkgPath).isFile()
    ) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: " + pathname);
      return;
    }

    const stat = fs.statSync(pkgPath);
    const ext = path.extname(pkgPath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Access-Control-Allow-Origin": "*",
      "Content-Disposition": `attachment; filename="${safeRel.replace(/"/g, "")}"`,
    });
    if (req.method === "HEAD") {
      res.end();
    } else {
      fs.createReadStream(pkgPath).pipe(res);
    }
    return;
  }

  let filePath = null;

  if (pathname.startsWith("/AllSoftDesktop/docs")) {
    const rel = pathname.slice("/AllSoftDesktop/docs".length) || "/";
    filePath = resolveFile(docsBuild, rel);
  } else if (pathname.startsWith("/AllSoftDesktop/launcher")) {
    const rel = pathname.slice("/AllSoftDesktop/launcher".length) || "/";
    filePath = resolveFile(launcherDist, rel);
  } else if (pathname.startsWith("/assets/")) {
    // Fallback cho asset của Vite Launcher khi chạy ở /AllSoftDesktop/launcher
    filePath = resolveFile(launcherDist, pathname);
  } else if (pathname.startsWith("/AllSoftDesktop")) {
    const rel = pathname.slice("/AllSoftDesktop".length) || "/";
    filePath = resolveFile(portalOut, rel);
  } else {
    filePath = resolveFile(portalOut, pathname);
  }

  if (!filePath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found: " + pathname);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}/AllSoftDesktop/`;
  console.log(`Server đang chạy tại: ${url}`);
  console.log(`- Web Portal:  http://localhost:${PORT}/AllSoftDesktop/`);
  console.log(`- Tài liệu:    http://localhost:${PORT}/AllSoftDesktop/docs/`);
  console.log(`- Launcher UI: http://localhost:${PORT}/AllSoftDesktop/launcher/`);
  if (process.argv.includes("--open")) {
    exec(`start "" "${url}"`);
  }
});
