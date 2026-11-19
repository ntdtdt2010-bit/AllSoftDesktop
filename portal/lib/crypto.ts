/**
 * Bảo mật xác thực Admin & Giải mã changelog phía client:
 * - Xác thực Admin: PBKDF2-SHA256 (600.000 vòng) trên chuỗi `${username}:${password}`
 *   với salt cố định (hoặc verifier ghi đè trong localStorage["allsoft_admin_verifier"]).
 * - Giải mã Changelog: AES-256-GCM + khoá dẫn xuất PBKDF2-SHA256 (600.000 vòng).
 */

import defaultEncryptedChangelog from "../public/changelog.enc.json";

export interface EncryptedPayload {
  version?: number;
  kdf?: string;
  iterations?: number;
  cipher?: string;
  salt?: string;
  iv?: string;
  data?: string;
  [key: string]: any;
}

export interface AdminVerifier {
  username?: string;
  salt: string;
  iterations: number;
  hash: string;
}

export const ADMIN_VERIFIER_STORAGE_KEY = "allsoft_admin_verifier";

// Precomputed PBKDF2-SHA256 (600,000 iterations, 32 bytes) cho tài khoản mặc định (không lưu plaintext password)
const DEFAULT_ADMIN_SALT_B64 = "QWxsU29mdEFkbWluU2FsdA==";
const DEFAULT_ADMIN_ITERATIONS = 600_000;
const DEFAULT_ADMIN_HASH_B64 = "9zLgcdWdduAk3QCgHB19B1mDqJgTP+6DNuUc5PZPZhc=";

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const buf = Buffer.from(b64, "base64");
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i];
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derivePbkdf2Bits(
  secret: string,
  saltBytes: Uint8Array<ArrayBuffer>,
  iterations: number
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

function getStoredVerifier(): AdminVerifier | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(ADMIN_VERIFIER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.salt === "string" &&
      typeof parsed.hash === "string" &&
      typeof parsed.iterations === "number"
    ) {
      return parsed as AdminVerifier;
    }
  } catch {
    // Bỏ qua nếu localStorage không khả dụng hoặc JSON lỗi
  }
  return null;
}

/**
 * Kiểm tra thông tin đăng nhập Admin bằng PBKDF2-SHA256 (600.000 vòng).
 */
export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const cleanUser = (username || "").trim();
  if (!cleanUser || !password) return false;

  const override = getStoredVerifier();
  const saltB64 = override?.salt ?? DEFAULT_ADMIN_SALT_B64;
  const iterations = override?.iterations ?? DEFAULT_ADMIN_ITERATIONS;
  const expectedHashB64 = override?.hash ?? DEFAULT_ADMIN_HASH_B64;

  const derived = await derivePbkdf2Bits(
    `${cleanUser}:${password}`,
    b64ToBytes(saltB64),
    iterations
  );
  const expected = b64ToBytes(expectedHashB64);
  return timingSafeEqualBytes(derived, expected);
}

/**
 * Đổi mật khẩu Admin và lưu PBKDF2 verifier mới vào localStorage.
 */
export async function changeAdminPassword(
  newUsername: string,
  newPassword: string
): Promise<void> {
  const cleanUser = (newUsername || "admin").trim();
  if (!cleanUser || !newPassword) {
    throw new Error("Tên đăng nhập và mật khẩu mới không được để trống.");
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePbkdf2Bits(
    `${cleanUser}:${newPassword}`,
    salt,
    DEFAULT_ADMIN_ITERATIONS
  );
  const verifier: AdminVerifier = {
    username: cleanUser,
    salt: bytesToB64(salt),
    iterations: DEFAULT_ADMIN_ITERATIONS,
    hash: bytesToB64(derived),
  };
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(ADMIN_VERIFIER_STORAGE_KEY, JSON.stringify(verifier));
  }
}

export async function decryptPayload(
  payload: EncryptedPayload,
  password: string
): Promise<string> {
  const effective: EncryptedPayload =
    payload && payload.salt && payload.iv && payload.data && payload.iterations
      ? payload
      : (defaultEncryptedChangelog as EncryptedPayload);

  if (
    !effective ||
    !effective.salt ||
    !effective.iv ||
    !effective.data ||
    !effective.iterations
  ) {
    throw new Error("Chưa có dữ liệu nhật ký mã hóa (changelog.enc.json).");
  }
  if (effective.version !== 1) {
    throw new Error("Phiên bản định dạng mã hóa không được hỗ trợ.");
  }

  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64ToBytes(effective.salt),
      iterations: effective.iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(effective.iv) },
      key,
      b64ToBytes(effective.data)
    );
    return new TextDecoder().decode(plain);
  } catch {
    // GCM sai tag => sai mật khẩu hoặc dữ liệu bị sửa
    throw new Error("WRONG_PASSWORD");
  }
}

/**
 * Giải mã trực tiếp changelog bằng mật khẩu (tự động nạp changelog.enc.json).
 */
export async function decryptChangelog(
  password: string,
  payloadOverride?: EncryptedPayload
): Promise<string> {
  if (
    payloadOverride &&
    payloadOverride.salt &&
    payloadOverride.iv &&
    payloadOverride.data &&
    payloadOverride.iterations
  ) {
    return decryptPayload(payloadOverride, password);
  }

  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const res = await fetch("/AllSoftDesktop/changelog.enc.json", {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as EncryptedPayload;
        return decryptPayload(data, password);
      }
    } catch {
      // Fallback sang bản đóng gói sẵn
    }
  }

  return decryptPayload(defaultEncryptedChangelog as EncryptedPayload, password);
}
