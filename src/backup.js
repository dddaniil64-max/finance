import { BACKUP_TABLES, BACKUP_ORDER, BACKUP_VERSION } from "./schema.js";

export const BACKUP_PREFIX = "backups/";
export const KEEP_BACKUPS = 30;
const KEY_RE = /^backups\/finance-[0-9TZ-]+\.json\.gz$/;
const PAGE = 5000;

export async function dumpDatabase(env, now = new Date()) {
  const tables = {};
  for (const name of BACKUP_ORDER) {
    const { cols } = BACKUP_TABLES[name], rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const { results } = await env.DB.prepare(`SELECT ${cols.join(",")} FROM ${name} ORDER BY rowid LIMIT ?1 OFFSET ?2`).bind(PAGE, offset).all();
      rows.push(...results.map((r) => cols.map((c) => r[c])));
      if (results.length < PAGE) break;
    }
    tables[name] = { cols, rows };
  }
  return { format: "finance-backup", version: BACKUP_VERSION, createdAt: now.toISOString(), tables };
}

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function pruneBackups(env, keep = KEEP_BACKUPS) {
  const keys = []; let cursor;
  do {
    const page = await env.BACKUPS.list({ prefix: BACKUP_PREFIX, cursor });
    keys.push(...page.objects.map((o) => o.key).filter((k) => KEY_RE.test(k)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort(); // имена содержат UTC-время, поэтому лексикографический порядок = хронологический
  const doomed = keys.slice(0, Math.max(0, keys.length - keep));
  for (let i = 0; i < doomed.length; i += 1000) await env.BACKUPS.delete(doomed.slice(i, i + 1000));
  return doomed.length;
}

export async function createBackup(env, now = new Date()) {
  if (!env.BACKUPS) throw new Error("R2-привязка BACKUPS не настроена");
  const dump = await dumpDatabase(env, now);
  const key = `${BACKUP_PREFIX}finance-${now.toISOString().replace(/[:.]/g, "-")}.json.gz`;
  await env.BACKUPS.put(key, await gzip(JSON.stringify(dump)), {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { version: String(BACKUP_VERSION), users: String(dump.tables.users.rows.length) },
  });
  const pruned = await pruneBackups(env);
  return { key, pruned };
}

export async function cleanupExpired(env, now = Date.now()) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<?1").bind(now),
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE expires_at<?1 OR used_at IS NOT NULL").bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE window_start<?1").bind(now - 24 * 3600_000),
  ]);
}

export async function runScheduled(env) {
  let failure = null;
  try { await cleanupExpired(env); } catch (e) { console.error("Очистка не удалась:", e.message); }
  try { const r = await createBackup(env); console.log(`Бэкап создан: ${r.key}, удалено старых: ${r.pruned}`); }
  catch (e) { console.error("Бэкап не удался:", e.message); failure = e; }
  if (failure) throw failure; // чтобы запуск cron отобразился как ошибочный
}
