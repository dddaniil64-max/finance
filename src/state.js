import { HttpError } from "./util.js";

export class ValidationError extends HttpError { constructor(msg) { super(400, msg); } }

const LIMITS = { accounts: 200, categories: 500, tx: 50000, budgets: 500, goals: 500, recurring: 500 };
const MAX_CENTS = 1e13;
const CURRENCIES = ["RUB", "EUR", "USD", "GBP"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const defaultState = () => ({
  settings: { currency: "RUB", theme: "light" },
  accounts: [{ id: "cash", name: "Наличные", type: "cash", start: 0 }, { id: "card", name: "Банковская карта", type: "card", start: 0 }],
  categories: [
    { id: "salary", name: "Зарплата", type: "income", icon: "💼", color: "#6658e8" },
    { id: "extra", name: "Дополнительный доход", type: "income", icon: "✨", color: "#18a879" },
    { id: "food", name: "Продукты", type: "expense", icon: "🛒", color: "#6658e8" },
    { id: "home", name: "Жильё", type: "expense", icon: "🏠", color: "#18a879" },
    { id: "transport", name: "Транспорт", type: "expense", icon: "🚕", color: "#ffb85c" },
    { id: "cafe", name: "Кафе", type: "expense", icon: "☕", color: "#e76b72" },
    { id: "health", name: "Здоровье", type: "expense", icon: "💊", color: "#38a6c8" },
    { id: "shopping", name: "Покупки", type: "expense", icon: "🛍️", color: "#a78bfa" },
    { id: "other", name: "Другое", type: "expense", icon: "📦", color: "#9ba4b8" },
  ],
  tx: [], budgets: [], goals: [], recurring: [],
});

// ---------- проверка входных данных ----------
const str = (v, max, def = "") => (v == null ? def : String(v).slice(0, max));
function cents(v, path) {
  const n = Math.round(Number(v ?? 0));
  if (!Number.isFinite(n) || Math.abs(n) > MAX_CENTS) throw new ValidationError(`Некорректная сумма: ${path}`);
  return n;
}
function id(v, path) {
  const s = v == null ? "" : String(v).trim();
  if (!s || s.length > 64) throw new ValidationError(`Некорректный идентификатор: ${path}`);
  return s;
}
function list(v, name) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ValidationError(`Поле ${name} должно быть списком`);
  if (v.length > LIMITS[name]) throw new ValidationError(`Слишком много записей: ${name}`);
  return v.map((x, i) => { if (!x || typeof x !== "object" || Array.isArray(x)) throw new ValidationError(`Некорректная запись: ${name}[${i}]`); return x; });
}
const uniq = (arr) => { const seen = new Set(); return arr.filter((x) => { const k = x.id ?? x.cat; if (seen.has(k)) return false; seen.add(k); return true; }); };
const optDate = (v) => (typeof v === "string" && DATE_RE.test(v) ? v : "");

export function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ValidationError("Некорректные финансовые данные");
  const s = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
  const settings = { currency: CURRENCIES.includes(s.currency) ? s.currency : "RUB", theme: s.theme === "dark" ? "dark" : "light" };
  const accounts = uniq(list(raw.accounts, "accounts").map((a, i) => ({
    id: id(a.id, `accounts[${i}].id`), name: str(a.name, 80, "Счёт") || "Счёт",
    type: ["cash", "card", "savings", "other"].includes(a.type) ? a.type : "other", start: cents(a.start, `accounts[${i}].start`),
  })));
  const categories = uniq(list(raw.categories, "categories").map((c, i) => {
    if (c.type !== "income" && c.type !== "expense") throw new ValidationError(`Некорректный тип категории: categories[${i}]`);
    return { id: id(c.id, `categories[${i}].id`), name: str(c.name, 80, "Категория") || "Категория", type: c.type, icon: str(c.icon, 16), color: /^#[0-9a-fA-F]{3,8}$/.test(c.color || "") ? c.color : "#9ba4b8" };
  }));
  const tx = uniq(list(raw.tx, "tx").map((t, i) => {
    if (!["income", "expense", "transfer"].includes(t.type)) throw new ValidationError(`Некорректный тип операции: tx[${i}]`);
    if (typeof t.date !== "string" || !DATE_RE.test(t.date)) throw new ValidationError(`Некорректная дата: tx[${i}]`);
    return { id: id(t.id, `tx[${i}].id`), type: t.type, amount: cents(t.amount, `tx[${i}].amount`), date: t.date, cat: str(t.cat, 64), acc: str(t.acc, 64), to: str(t.to, 64), note: str(t.note, 500), ts: cents(t.ts, `tx[${i}].ts`) };
  }));
  const budgets = uniq(list(raw.budgets, "budgets").map((b, i) => ({ id: id(b.cat, `budgets[${i}].cat`), cat: id(b.cat, `budgets[${i}].cat`), limit: cents(b.limit, `budgets[${i}].limit`) })));
  const goals = uniq(list(raw.goals, "goals").map((g, i) => ({ id: id(g.id, `goals[${i}].id`), name: str(g.name, 80, "Цель") || "Цель", target: cents(g.target, `goals[${i}].target`), saved: cents(g.saved, `goals[${i}].saved`), deadline: optDate(g.deadline) })));
  const recurring = uniq(list(raw.recurring, "recurring").map((r, i) => {
    if (r.type !== "income" && r.type !== "expense") throw new ValidationError(`Некорректный тип регулярной операции: recurring[${i}]`);
    return { id: id(r.id, `recurring[${i}].id`), type: r.type, amount: cents(r.amount, `recurring[${i}].amount`), cat: str(r.cat, 64), acc: str(r.acc, 64), freq: ["weekly", "monthly", "yearly"].includes(r.freq) ? r.freq : "monthly", next: optDate(r.next), note: str(r.note, 500) };
  }));
  return { settings, accounts, categories, tx, budgets: budgets.map(({ cat, limit }) => ({ cat, limit })), goals, recurring };
}

// ---------- сопоставление state ⇄ таблицы ----------
const TABLES = {
  accounts: { cols: ["id", "name", "type", "start_balance", "position"], order: "position",
    rows: (s) => s.accounts.map((a, i) => [a.id, a.name, a.type, a.start, i]),
    obj: (r) => ({ id: r[0], name: r[1], type: r[2], start: r[3] }) },
  categories: { cols: ["id", "name", "type", "icon", "color", "position"], order: "position",
    rows: (s) => s.categories.map((c, i) => [c.id, c.name, c.type, c.icon, c.color, i]),
    obj: (r) => ({ id: r[0], name: r[1], type: r[2], icon: r[3], color: r[4] }) },
  transactions: { cols: ["id", "type", "amount", "date", "category_id", "account_id", "to_account_id", "note", "ts"], order: "date, ts, rowid",
    rows: (s) => s.tx.map((t) => [t.id, t.type, t.amount, t.date, t.cat, t.acc, t.to, t.note, t.ts]),
    obj: (r) => ({ id: r[0], type: r[1], amount: r[2], date: r[3], cat: r[4], acc: r[5], to: r[6], note: r[7], ts: r[8] }) },
  budgets: { cols: ["category_id", "limit_amount", "position"], order: "position",
    rows: (s) => s.budgets.map((b, i) => [b.cat, b.limit, i]),
    obj: (r) => ({ cat: r[0], limit: r[1] }) },
  goals: { cols: ["id", "name", "target", "saved", "deadline", "position"], order: "position",
    rows: (s) => s.goals.map((g, i) => [g.id, g.name, g.target, g.saved, g.deadline, i]),
    obj: (r) => ({ id: r[0], name: r[1], target: r[2], saved: r[3], deadline: r[4] }) },
  recurring: { cols: ["id", "type", "amount", "category_id", "account_id", "freq", "next_date", "note", "position"], order: "position",
    rows: (s) => s.recurring.map((r, i) => [r.id, r.type, r.amount, r.cat, r.acc, r.freq, r.next, r.note, i]),
    obj: (r) => ({ id: r[0], type: r[1], amount: r[2], cat: r[3], acc: r[4], freq: r[5], next: r[6], note: r[7] }) },
};
const STATE_KEY = { accounts: "accounts", categories: "categories", transactions: "tx", budgets: "budgets", goals: "goals", recurring: "recurring" };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

export async function readRows(env, userId) {
  const names = Object.keys(TABLES);
  const stmts = [env.DB.prepare("SELECT currency, theme, updated_at FROM user_settings WHERE user_id=?1").bind(userId)];
  for (const n of names) stmts.push(env.DB.prepare(`SELECT ${TABLES[n].cols.join(",")} FROM ${n} WHERE user_id=?1 ORDER BY ${TABLES[n].order}`).bind(userId));
  const res = await env.DB.batch(stmts);
  const tables = {};
  names.forEach((n, i) => { tables[n] = res[i + 1].results.map((r) => TABLES[n].cols.map((c) => r[c])); });
  return { settings: res[0].results[0] || null, tables };
}

export async function loadState(env, userId) {
  const { settings, tables } = await readRows(env, userId);
  if (!settings) return null;
  const state = { settings: { currency: settings.currency, theme: settings.theme } };
  for (const n of Object.keys(TABLES)) state[STATE_KEY[n]] = tables[n].map(TABLES[n].obj);
  return { state, updatedAt: settings.updated_at };
}

// Формирует только изменённые операции: вставки/обновления/удаления относительно того, что уже в базе.
export function stateStatements(db, userId, state, existing, now = Date.now()) {
  const stmts = [];
  for (const [name, t] of Object.entries(TABLES)) {
    const old = new Map((existing?.tables?.[name] || []).map((r) => [String(r[0]), JSON.stringify(r)]));
    const changed = [], seen = new Set();
    for (const r of t.rows(state)) { const k = String(r[0]); seen.add(k); if (old.get(k) !== JSON.stringify(r)) changed.push(r); }
    const removed = [...old.keys()].filter((k) => !seen.has(k));
    for (const part of chunk(removed, 500))
      stmts.push(db.prepare(`DELETE FROM ${name} WHERE user_id=?1 AND ${t.cols[0]} IN (SELECT value FROM json_each(?2))`).bind(userId, JSON.stringify(part)));
    const pick = t.cols.map((_, i) => `json_extract(value,'$[${i}]')`).join(",");
    const sets = t.cols.slice(1).map((c) => `${c}=excluded.${c}`).join(",");
    for (const part of chunk(changed, 300))
      stmts.push(db.prepare(`INSERT INTO ${name}(user_id,${t.cols.join(",")}) SELECT ?1,${pick} FROM json_each(?2) WHERE true ON CONFLICT(user_id,${t.cols[0]}) DO UPDATE SET ${sets}`).bind(userId, JSON.stringify(part)));
  }
  stmts.push(db.prepare(
    `INSERT INTO user_settings(user_id,currency,theme,migrated_at,updated_at) VALUES(?1,?2,?3,?4,?4)
     ON CONFLICT(user_id) DO UPDATE SET currency=excluded.currency, theme=excluded.theme, updated_at=excluded.updated_at`
  ).bind(userId, state.settings.currency, state.settings.theme, now));
  return stmts;
}
