export const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export const COOKIE = "finance_session";
export const SESSION_DAYS = 30;
// Cloudflare Workers ограничивает PBKDF2 числом итераций 100 000.
export const PBKDF2_ITERATIONS = 100000;
const encoder = new TextEncoder();

export class HttpError extends Error {
  constructor(status, message, headers = {}) { super(message); this.status = status; this.headers = headers; }
}
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
export const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
export async function sha256(value) { return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value))); }
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export async function hashPassword(password, salt = randomToken(16), iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations, hash: "SHA-256" }, key, 256);
  return { salt, hash: hex(bits), iterations };
}
export async function verifyPassword(password, salt, expected, iterations = PBKDF2_ITERATIONS) {
  const actual = await hashPassword(password, salt, iterations);
  return timingSafeEqual(actual.hash, expected);
}
export const cookie = (token, maxAge = SESSION_DAYS * 86400) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
export function getCookie(request) {
  const raw = request.headers.get("Cookie") || "";
  const part = raw.split(";").map((x) => x.trim()).find((x) => x.startsWith(COOKIE + "="));
  return part ? part.slice(COOKIE.length + 1) : null;
}
export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";
export async function readJson(request, max = 65536) {
  let text;
  try { text = await request.text(); } catch { throw new HttpError(400, "Некорректный запрос"); }
  if (text.length > max) throw new HttpError(413, "Размер данных превышает допустимый лимит");
  try { return JSON.parse(text); } catch { throw new HttpError(400, "Некорректный запрос"); }
}
