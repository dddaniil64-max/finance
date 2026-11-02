#!/usr/bin/env node
// Преобразует резервную копию FINANCE (.json или .json.gz из R2) в SQL для восстановления в D1.
//
//   node scripts/backup-to-sql.mjs backup.json.gz restore.sql [--wipe] [--user email-или-id]
//   npx wrangler d1 execute finance-manager-db --remote --file restore.sql
//
// --wipe  перед вставкой удалить текущие данные (всех пользователей или только указанного)
// --user  восстановить только одного пользователя
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { BACKUP_TABLES, BACKUP_ORDER } from "../src/schema.js";

const IDENT = /^[a-z_][a-z0-9_]*$/;
export function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("Недопустимое число в копии"); return String(v); }
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  throw new Error("Недопустимый тип значения в копии: " + typeof v);
}

export function parseBackup(buf) {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  const data = JSON.parse(raw.toString("utf8"));
  if (data?.format !== "finance-backup" || !data.tables) throw new Error("Это не резервная копия FINANCE");
  return data;
}

export function backupToSql(backup, { wipe = false, user = null } = {}) {
  const out = [`-- FINANCE restore; backup created ${backup.createdAt}${user ? "; user " + user : ""}`];
  const users = backup.tables.users;
  const ui = users.cols;
  let ids = null;
  if (user) {
    const hit = users.rows.filter((r) => r[ui.indexOf("id")] === user || r[ui.indexOf("email")] === user.toLowerCase());
    if (!hit.length) throw new Error(`Пользователь ${user} не найден в копии`);
    ids = new Set(hit.map((r) => r[ui.indexOf("id")]));
  }
  const keep = (name, row) => !ids || ids.has(row[backup.tables[name].cols.indexOf(BACKUP_TABLES[name].userCol)]);
  if (wipe) {
    for (const name of [...BACKUP_ORDER].reverse()) {
      if (!ids) out.push(`DELETE FROM ${name};`);
      else for (const id of ids) out.push(`DELETE FROM ${name} WHERE ${BACKUP_TABLES[name].userCol}=${sqlValue(id)};`);
    }
  }
  for (const name of BACKUP_ORDER) {
    const def = BACKUP_TABLES[name], t = backup.tables[name];
    if (!t) continue;
    // Столбцы берём из белого списка, а не из файла: в SQL не попадают произвольные имена.
    const idx = def.cols.map((c) => { const i = t.cols.indexOf(c); return i; });
    for (const row of t.rows) {
      if (!keep(name, row)) continue;
      const vals = idx.map((i) => (i < 0 ? null : row[i]));
      out.push(`INSERT OR REPLACE INTO ${name}(${def.cols.join(",")}) VALUES(${vals.map(sqlValue).join(",")});`);
    }
  }
  for (const n of BACKUP_ORDER) if (!IDENT.test(n)) throw new Error("bad identifier");
  return out.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), flags = { wipe: false, user: null }, pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--wipe") flags.wipe = true;
    else if (args[i] === "--user") flags.user = args[++i];
    else pos.push(args[i]);
  }
  if (pos.length !== 2) { console.error("Использование: node scripts/backup-to-sql.mjs <backup.json[.gz]> <restore.sql> [--wipe] [--user email]"); process.exit(1); }
  const sql = backupToSql(parseBackup(readFileSync(pos[0])), flags);
  writeFileSync(pos[1], sql);
  console.log(`Готово: ${pos[1]} (${sql.split("\n").length - 1} строк)`);
}
