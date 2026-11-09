import crypto from "node:crypto";

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function sha256Base64(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("base64");
}

export function md5Hex(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

export function isSha256Hex(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

export function isSha256Base64(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  try {
    return Buffer.from(value, "base64").length === 32;
  } catch {
    return false;
  }
}

export function checksumsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function base64ToHex(value: string): string {
  return Buffer.from(value, "base64").toString("hex");
}
