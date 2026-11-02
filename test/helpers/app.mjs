import worker from "../../src/index.js";
import { createD1, createR2 } from "./d1.mjs";

export function createEnv(extra = {}) {
  return { DB: createD1(), BACKUPS: createR2(), ASSETS: { fetch: () => new Response("asset") }, RESEND_API_KEY: "re_test", MAIL_FROM: "FINANCE <noreply@example.com>", APP_URL: "https://finance.example", ...extra };
}

// Клиент с cookie-jar поверх worker.fetch
export function createClient(env, ip = "203.0.113.10") {
  const pending = [];
  const ctx = { waitUntil: (p) => pending.push(p) };
  let cookie = "";
  const client = {
    ctx, pending,
    async call(method, path, body, headers = {}) {
      const req = new Request("https://finance.example" + path, {
        method, headers: { "content-type": "application/json", "CF-Connecting-IP": ip, ...(cookie ? { cookie } : {}), ...headers },
        body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      const res = await worker.fetch(req, env, ctx);
      const sc = res.headers.get("set-cookie");
      if (sc) { const pair = sc.split(";")[0]; cookie = pair.endsWith("=") ? "" : pair; }
      await Promise.all(pending.splice(0));
      let data = null; try { data = await res.clone().json(); } catch {}
      return { status: res.status, data, headers: res.headers };
    },
    get: (p) => client.call("GET", p),
    post: (p, b) => client.call("POST", p, b),
    put: (p, b) => client.call("PUT", p, b),
  };
  return client;
}

export function mockResend() {
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith("https://api.resend.com/")) { sent.push({ url: String(url), headers: opts.headers, body: JSON.parse(opts.body) }); return new Response("{}", { status: 200 }); }
    return original(url, opts);
  };
  return { sent, restore: () => { globalThis.fetch = original; } };
}

export const PASSWORD = "correct horse battery";
export const register = (client, email = "anna@example.com", name = "Анна") => client.post("/api/auth/register", { email, password: PASSWORD, name });
