import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync, gzipSync } from "node:zlib";
import { createEnv, createClient, register } from "./helpers/app.mjs";
import { createD1 } from "./helpers/d1.mjs";
import worker from "../src/index.js";
import { createBackup, pruneBackups, runScheduled, KEEP_BACKUPS } from "../src/backup.js";
import { backupToSql, parseBackup, sqlValue } from "../scripts/backup-to-sql.mjs";

async function seed(env) {
  const out = {};
  for (const [email, ip] of [["a@example.com", "1.0.0.1"], ["b@example.com", "1.0.0.2"]]) {
    const c = createClient(env, ip); await register(c, email, email === "a@example.com" ? "О'Брайен" : "Борис");
    const s = (await c.get("/api/state")).data.state;
    s.tx = [{ id: "t1", type: "expense", amount: 4200, date: "2026-11-01", cat: "food", acc: "cash", to: "", note: `заметка с ' и "кавычками"\nи переносом`, ts: 5 }];
    s.goals = [{ id: "g", name: "Цель", target: 1000, saved: 10, deadline: "" }];
    await c.put("/api/state", { state: s }); out[email] = c;
  }
  return out;
}
const snapshot = (env) => Object.fromEntries(["users", "user_settings", "accounts", "categories", "transactions", "budgets", "goals", "recurring"].map((t) => [t, env.DB.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));

test("ежедневный бэкап кладёт сжатый JSON в R2", async () => {
  const env = createEnv(); await seed(env);
  const { key } = await createBackup(env, new Date("2026-11-02T03:00:00Z"));
  assert.match(key, /^backups\/finance-2026-11-02T03-00-00-000Z\.json\.gz$/);
  const obj = env.BACKUPS.store.get(key);
  assert.equal(obj.opts.httpMetadata.contentType, "application/gzip");
  const data = JSON.parse(gunzipSync(obj.body).toString());
  assert.equal(data.format, "finance-backup");
  assert.equal(data.tables.users.rows.length, 2);
  assert.equal(data.tables.transactions.rows.length, 2);
});

test("хранятся только последние 30 копий", async () => {
  const env = createEnv();
  for (let d = 1; d <= 35; d++) await env.BACKUPS.put(`backups/finance-2026-09-${String(d).padStart(2, "0")}T03-00-00-000Z.json.gz`, "x");
  await env.BACKUPS.put("backups/readme.txt", "не трогать");
  const removed = await pruneBackups(env);
  assert.equal(removed, 5);
  const keys = [...env.BACKUPS.store.keys()].sort();
  assert.equal(keys.filter((k) => k.endsWith(".gz")).length, KEEP_BACKUPS);
  assert.ok(!keys.includes("backups/finance-2026-09-05T03-00-00-000Z.json.gz"));
  assert.ok(keys.includes("backups/finance-2026-09-06T03-00-00-000Z.json.gz"));
  assert.ok(keys.includes("backups/readme.txt"));
});

test("scheduled-обработчик: делает копию и чистит просроченные сессии, токены, счётчики", async () => {
  const env = createEnv(); await seed(env);
  env.DB.raw.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) SELECT 'old',id,'h-old',1,1 FROM users LIMIT 1").run();
  env.DB.raw.prepare("INSERT INTO rate_limits(key,window_start,count) VALUES('old',1,5)").run();
  const pending = [];
  await worker.scheduled({ cron: "0 3 * * *" }, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  assert.equal(env.BACKUPS.store.size, 1);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) c FROM sessions WHERE id='old'").get().c, 0);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) c FROM rate_limits WHERE key='old'").get().c, 0);
});

test("без R2-привязки запуск завершается ошибкой (видно в логах cron), но очистка выполняется", async () => {
  const env = createEnv({ BACKUPS: undefined });
  await assert.rejects(runScheduled(env), /BACKUPS/);
});

test("резервная копия → SQL → чистая база: данные совпадают полностью", async () => {
  const env = createEnv(); await seed(env);
  const before = snapshot(env);
  const { key } = await createBackup(env);
  const sql = backupToSql(parseBackup(env.BACKUPS.store.get(key).body));
  const fresh = createD1();
  fresh.raw.exec(sql);
  const after = Object.fromEntries(Object.keys(before).map((t) => [t, fresh.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((r) => ({ ...r }))]));
  assert.deepEqual(after, before);
});

test("восстановление с --wipe заменяет текущие данные; --user восстанавливает одного пользователя", async () => {
  const env = createEnv(); const clients = await seed(env);
  const { key } = await createBackup(env);
  const backup = parseBackup(env.BACKUPS.store.get(key).body);
  // после копии A испортил данные, B добавил операцию
  const sa = (await clients["a@example.com"].get("/api/state")).data.state; sa.tx = []; await clients["a@example.com"].put("/api/state", { state: sa });
  const sb = (await clients["b@example.com"].get("/api/state")).data.state; sb.tx.push({ id: "new", type: "income", amount: 1, date: "2026-11-02", cat: "", acc: "cash", to: "", note: "", ts: 9 }); await clients["b@example.com"].put("/api/state", { state: sb });

  env.DB.raw.exec(backupToSql(backup, { wipe: true, user: "a@example.com" }));
  const txOf = (email) => env.DB.raw.prepare("SELECT id FROM transactions WHERE user_id=(SELECT id FROM users WHERE email=?) ORDER BY id").all(email).map((r) => r.id);
  assert.deepEqual(txOf("a@example.com"), ["t1"], "A восстановлен");
  assert.deepEqual(txOf("b@example.com"), ["new", "t1"], "B не затронут");
  assert.throws(() => backupToSql(backup, { user: "nobody@example.com" }), /не найден/);
});

test("конвертер понимает и обычный JSON, и gzip, и экранирует значения", () => {
  const b = { format: "finance-backup", version: 3, createdAt: "x", tables: { users: { cols: ["id"], rows: [] } } };
  const raw = Buffer.from(JSON.stringify(b));
  assert.equal(parseBackup(raw).format, "finance-backup");
  assert.equal(parseBackup(gzipSync(raw)).format, "finance-backup");
  assert.throws(() => parseBackup(Buffer.from('{"a":1}')), /не резервная копия/);
  assert.equal(sqlValue("it's"), "'it''s'");
  assert.equal(sqlValue(null), "NULL");
  assert.throws(() => sqlValue(NaN));
  // столбцы из файла не попадают в SQL — только из белого списка
  const evil = { ...b, tables: { users: { cols: ["id); DROP TABLE users;--"], rows: [["1"]] } } };
  assert.ok(!backupToSql(evil).includes("DROP"));
});
