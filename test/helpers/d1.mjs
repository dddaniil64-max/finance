// Мини-эмулятор D1 поверх встроенного node:sqlite — чтобы проверять Worker без Cloudflare.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const isQuery = (sql) => /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
const clean = (p) => p.map((v) => (v === undefined ? null : v));

export function createD1({ migrations = true, upTo = Infinity } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, clean(p)); }
    exec() { const s = db.prepare(this.sql); if (isQuery(this.sql)) return { results: s.all(...this.params), success: true }; const i = s.run(...this.params); return { results: [], success: true, meta: { changes: Number(i.changes) } }; }
    async first() { return db.prepare(this.sql).get(...this.params) ?? null; }
    async all() { return this.exec(); }
    async run() { return this.exec(); }
  }
  const d1 = {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      db.exec("BEGIN");
      try { const out = stmts.map((s) => s.exec()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
  };
  if (migrations) {
    const dir = new URL("../../migrations/", import.meta.url);
    readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().slice(0, upTo).forEach((f) => db.exec(readFileSync(new URL(f, dir), "utf8")));
  }
  return d1;
}

export function createR2() {
  const store = new Map();
  return {
    store,
    async put(key, body, opts) { store.set(key, { body: Buffer.from(body), opts }); },
    async list({ prefix = "" } = {}) { return { objects: [...store.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }; },
    async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
  };
}
