// Mã hoá changelog (AES-256-GCM + PBKDF2-SHA256) -> public/changelog.enc.json
// Dùng: CHANGELOG_PASSWORD=... node scripts/encrypt-changelog.mjs [--password <mk>] [--in file.md] [--out file.json]
// Không có mật khẩu: bỏ qua mã hoá (không làm hỏng build), giữ nguyên file cũ nếu có.
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const inFile = resolve(arg("--in") ?? resolve(here, "../data/changelog.md"));
const outFile = resolve(arg("--out") ?? resolve(here, "../public/changelog.enc.json"));
const password = arg("--password") ?? process.env.CHANGELOG_PASSWORD;
const ITERATIONS = 600_000;

if (!password) {
  console.warn("[encrypt-changelog] Thiếu CHANGELOG_PASSWORD -> bỏ qua mã hoá." +
    (existsSync(outFile) ? " Giữ nguyên file cũ." : " (Trang changelog sẽ báo chưa có dữ liệu.)"));
  process.exit(0);
}
if (!existsSync(inFile)) {
  console.error(`[encrypt-changelog] Không thấy nguồn changelog: ${inFile}`);
  process.exit(1);
}

function encrypt(plain, pass) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(pass, salt, ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    cipher: "AES-256-GCM",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: Buffer.concat([ct, tag]).toString("base64"), // giống WebCrypto: ciphertext || tag
  };
}

function decrypt(p, pass) {
  const key = pbkdf2Sync(pass, Buffer.from(p.salt, "base64"), p.iterations, 32, "sha256");
  const raw = Buffer.from(p.data, "base64");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(p.iv, "base64"));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]).toString("utf8");
}

const plain = readFileSync(inFile, "utf8");
const payload = encrypt(plain, password);

// Kiểm tra vòng mã hoá -> giải mã trước khi ghi
if (decrypt(payload, password) !== plain) {
  console.error("[encrypt-changelog] Kiểm tra giải mã thất bại!");
  process.exit(1);
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(payload, null, 2) + "\n");
console.log(`[encrypt-changelog] OK -> ${outFile} (${plain.length} ký tự, PBKDF2 ${ITERATIONS} vòng)`);
