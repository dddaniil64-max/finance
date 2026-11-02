// Локальный сервер без Cloudflare (npm run dev:local): настоящий Worker + D1-эмулятор + статика из public/.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import worker from "../src/index.js";
import { createEnv, mockResend } from "../test/helpers/app.mjs";

const root = join(process.cwd(), "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };
const mail = mockResend();
const env = createEnv({ APP_URL: "http://localhost:4199" });
env.ASSETS = { async fetch(req) {
  const p = new URL(req.url).pathname;
  let file = normalize(join(root, p === "/" ? "index.html" : p));
  let data; try { data = await readFile(file); } catch { file = join(root, "index.html"); data = await readFile(file); }
  return new Response(data, { headers: { "content-type": types[extname(file)] || "application/octet-stream" } });
} };
createServer(async (req, res) => {
  if (req.url === "/__mail") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(mail.sent)); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const url = "http://localhost:4199" + req.url;
  const request = new Request(url, { method: req.method, headers: { ...req.headers, "CF-Connecting-IP": "127.0.0." + (1 + Math.floor(Math.random() * 200)) }, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) });
  const pending = [];
  const r = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
  if (r.headers.get("set-cookie")) headers["set-cookie"] = r.headers.get("set-cookie");
  res.writeHead(r.status, headers); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(4199, () => console.log("e2e server on 4199"));
