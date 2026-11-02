import { HttpError, json, randomToken, sha256, hashPassword, verifyPassword, cookie, getCookie, clientIp, readJson, SESSION_DAYS } from "./util.js";
import { peek, hit, clear } from "./ratelimit.js";
import { loadState, readRows, stateStatements, normalizeState, defaultState } from "./state.js";
import { sendResetEmail } from "./mail.js";

const RESET_TTL_MS = 3600_000;
const STATE_MAX_BYTES = 8_000_000;
const validEmail = (e) => /^\S+@\S+\.\S+$/.test(e) && e.length <= 190;
const tooMany = (sec) => new HttpError(429, `Слишком много попыток. Повторите через ${Math.max(1, Math.ceil(sec / 60))} мин.`, { "retry-after": String(sec) });

async function guard(env, key, limit, windowSec) { const r = await peek(env, key, limit, windowSec); if (r.limited) throw tooMany(r.retryAfter); }
async function count(env, key, limit, windowSec) { const r = await hit(env, key, windowSec); if (r.count > limit) throw tooMany(r.retryAfter); }

async function userFor(request, env) {
  const token = getCookie(request); if (!token) return null;
  const hash = await sha256(token);
  return (await env.DB.prepare("SELECT u.id,u.email,u.name,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1").bind(hash, Date.now()).first()) || null;
}
function validOrigin(request) {
  const origin = request.headers.get("Origin"); if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
async function issueSession(userId, env) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), userId, await sha256(token), Date.now() + SESSION_DAYS * 86400000, Date.now()).run();
  return token;
}
const checkPassword = (p) => { if (p.length < 10 || p.length > 128) throw new HttpError(400, "Пароль должен содержать от 10 до 128 символов"); };

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname, method = request.method, ip = clientIp(request);
  if (!validOrigin(request) && method !== "GET") throw new HttpError(403, "Недопустимый источник запроса");
  if (path === "/api/health") return json({ ok: true, service: "FINANCE API", version: "3.0.0" });

  if (path === "/api/auth/register" && method === "POST") {
    await count(env, `register:ip:${ip}`, 10, 3600);
    const data = await readJson(request);
    const email = String(data.email || "").trim().toLowerCase(), password = String(data.password || ""), name = String(data.name || "").trim().slice(0, 80);
    if (!validEmail(email)) throw new HttpError(400, "Укажите корректный email");
    checkPassword(password);
    if (await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) throw new HttpError(409, "Аккаунт с таким email уже существует");
    const id = crypto.randomUUID(), pw = await hashPassword(password), now = Date.now(), displayName = name || email.split("@")[0];
    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO users(id,email,name,password_salt,password_hash,password_iter,created_at) VALUES(?,?,?,?,?,?,?)").bind(id, email, displayName, pw.salt, pw.hash, pw.iterations, now),
        ...stateStatements(env.DB, id, defaultState(), null, now),
      ]);
    } catch (e) { if (String(e).includes("UNIQUE")) throw new HttpError(409, "Аккаунт с таким email уже существует"); throw e; }
    const token = await issueSession(id, env);
    return json({ user: { id, email, name: displayName } }, 201, { "set-cookie": cookie(token) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const data = await readJson(request);
    const email = String(data.email || "").trim().toLowerCase(), password = String(data.password || "");
    const ipKey = `login:ip:${ip}`, emailKey = `login:email:${await sha256(email)}`;
    await guard(env, ipKey, 30, 900); await guard(env, emailKey, 8, 900);
    const row = await env.DB.prepare("SELECT id,email,name,password_salt,password_hash,password_iter FROM users WHERE email=?").bind(email).first();
    // Для несуществующего email тоже считаем хеш — одинаковое время ответа.
    const ok = row ? await verifyPassword(password, row.password_salt, row.password_hash, row.password_iter) : (await hashPassword(password, "no-such-user"), false);
    if (!ok) { await hit(env, ipKey, 900); await hit(env, emailKey, 900); throw new HttpError(401, "Неверный email или пароль"); }
    await clear(env, emailKey);
    const token = await issueSession(row.id, env);
    return json({ user: { id: row.id, email: row.email, name: row.name } }, 200, { "set-cookie": cookie(token) });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = getCookie(request);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  if (path === "/api/auth/forgot" && method === "POST") {
    const data = await readJson(request);
    const email = String(data.email || "").trim().toLowerCase();
    if (!validEmail(email)) throw new HttpError(400, "Укажите корректный email");
    await count(env, `forgot:ip:${ip}`, 10, 3600);
    const generic = json({ ok: true, message: "Если аккаунт с таким email существует, мы отправили письмо со ссылкой для сброса пароля." });
    const perEmail = await hit(env, `forgot:email:${await sha256(email)}`, 3600);
    if (perEmail.count > 3) return generic;
    const user = await env.DB.prepare("SELECT id,email,name FROM users WHERE email=?").bind(email).first();
    if (!user) return generic;
    const token = randomToken(), now = Date.now();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id=?1").bind(user.id),
      env.DB.prepare("INSERT INTO password_reset_tokens(id,user_id,token_hash,expires_at,created_at) VALUES(?1,?2,?3,?4,?5)").bind(crypto.randomUUID(), user.id, await sha256(token), now + RESET_TTL_MS, now),
    ]);
    const base = (env.APP_URL || url.origin).replace(/\/+$/, "");
    ctx.waitUntil(sendResetEmail(env, { to: user.email, name: user.name, link: `${base}/?reset=${token}` }).catch((e) => console.error("Не удалось отправить письмо сброса:", e.message)));
    return generic;
  }

  if (path === "/api/auth/reset" && method === "POST") {
    await count(env, `reset:ip:${ip}`, 20, 900);
    const data = await readJson(request);
    const token = String(data.token || ""), password = String(data.password || "");
    checkPassword(password);
    const now = Date.now();
    // Атомарно «сжигаем» токен: сработает только для неиспользованного и непросроченного.
    const used = await env.DB.prepare("UPDATE password_reset_tokens SET used_at=?1 WHERE token_hash=?2 AND used_at IS NULL AND expires_at>?1 RETURNING user_id").bind(now, await sha256(token)).first();
    if (!used) throw new HttpError(400, "Ссылка недействительна или устарела. Запросите новую.");
    const pw = await hashPassword(password);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET password_salt=?1,password_hash=?2,password_iter=?3 WHERE id=?4").bind(pw.salt, pw.hash, pw.iterations, used.user_id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id=?1").bind(used.user_id),
      env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id=?1").bind(used.user_id),
    ]);
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  const user = await userFor(request, env);
  if (path === "/api/auth/me" && method === "GET") return json(user ? { user: { id: user.id, email: user.email, name: user.name } } : { user: null });
  if (!user) throw new HttpError(401, "Требуется авторизация");

  if (path === "/api/state" && method === "GET") {
    const result = await loadState(env, user.id);
    return json(result || { state: null });
  }
  if (path === "/api/state" && method === "PUT") {
    const data = await readJson(request, STATE_MAX_BYTES);
    const state = normalizeState(data && data.state);
    const existing = await readRows(env, user.id), now = Date.now();
    await env.DB.batch(stateStatements(env.DB, user.id, state, existing, now));
    return json({ ok: true, updatedAt: now });
  }
  if (path === "/api/auth/profile" && method === "PATCH") {
    const data = await readJson(request);
    const name = String(data?.name || "").trim().slice(0, 80);
    if (!name) throw new HttpError(400, "Имя не может быть пустым");
    await env.DB.prepare("UPDATE users SET name=? WHERE id=?").bind(name, user.id).run();
    return json({ user: { id: user.id, email: user.email, name } });
  }
  throw new HttpError(404, "Маршрут не найден");
}
