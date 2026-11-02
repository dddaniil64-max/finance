import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./helpers/d1.mjs";
import { readFileSync } from "node:fs";

const sql = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8");

test("миграции 0001→0003 выполняются в SQLite, повторный запуск 0003 безопасен", () => {
  const d1 = createD1({ migrations: false }), db = d1.raw;
  db.exec(sql("0001_initial.sql")); db.exec(sql("0002_normalized_tables.sql")); db.exec(sql("0003_migrate_legacy_data.sql")); db.exec(sql("0003_migrate_legacy_data.sql"));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ["users", "sessions", "user_data", "user_settings", "accounts", "categories", "transactions", "budgets", "goals", "recurring", "password_reset_tokens", "rate_limits"]) assert.ok(tables.includes(t), t);
});

test("данные из старого формата переносятся в таблицы, мусор пропускается, user_data остаётся", () => {
  const d1 = createD1({ migrations: false }), db = d1.raw;
  db.exec(sql("0001_initial.sql"));
  const addUser = (id) => db.prepare("INSERT INTO users(id,email,name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,1)").run(id, id + "@x.io", id, "s", "h");
  const legacy = {
    settings: { currency: "USD", theme: "dark" },
    accounts: [{ id: "cash", name: "Наличные", type: "cash", start: 1000 }, { id: "card", name: "Карта", type: "card", start: 0 }],
    categories: [{ id: "food", name: "Еда", type: "expense", icon: "🛒", color: "#fff" }, { id: "bad", name: "Плохая", type: "weird" }],
    tx: [
      { id: "t1", type: "expense", amount: 1250, date: "2026-10-01", cat: "food", acc: "cash", note: "хлеб" },
      { id: "t2", type: "transfer", amount: 500, date: "2026-10-02", acc: "cash", to: "card" },
      { id: "t3", type: "expense", amount: 1, date: "вчера", acc: "cash" },
      { type: "income", amount: 5, date: "2026-10-03" },
      { id: "t1", type: "income", amount: 99, date: "2026-10-04" },
      "мусор",
    ],
    budgets: [{ cat: "food", limit: 300000 }],
    goals: [{ id: "g1", name: "Отпуск", target: 100000, saved: 5000, deadline: "2027-01-01" }],
    recurring: [{ id: "r1", type: "expense", amount: 700, cat: "food", acc: "cash", freq: "yearly", next: "2027-02-01", note: "налог" }],
  };
  addUser("u1"); addUser("u2"); addUser("u3"); addUser("u4");
  const put = db.prepare("INSERT INTO user_data(user_id,state_json,updated_at) VALUES(?,?,?)");
  put.run("u1", JSON.stringify(legacy), 111);
  put.run("u2", "это не JSON {{{", 222);
  put.run("u3", JSON.stringify({ accounts: { oops: 1 }, tx: "нет", goals: null }), 333);
  // u4 без user_data вообще
  db.exec(sql("0002_normalized_tables.sql")); db.exec(sql("0003_migrate_legacy_data.sql"));

  const q = (s, ...p) => db.prepare(s).all(...p);
  assert.deepEqual({ ...q("SELECT currency,theme,updated_at FROM user_settings WHERE user_id='u1'")[0] }, { currency: "USD", theme: "dark", updated_at: 111 });
  assert.equal(q("SELECT * FROM user_settings").length, 3, "u1,u2,u3 получили настройки; u4 без данных — нет");
  assert.deepEqual(q("SELECT id,start_balance,position FROM accounts WHERE user_id='u1' ORDER BY position").map((r) => ({ ...r })), [{ id: "cash", start_balance: 1000, position: 0 }, { id: "card", start_balance: 0, position: 1 }]);
  assert.deepEqual(q("SELECT id FROM categories WHERE user_id='u1'").map((r) => r.id), ["food"]);
  assert.deepEqual(q("SELECT id,amount,note FROM transactions WHERE user_id='u1' ORDER BY id").map((r) => ({ ...r })), [{ id: "t1", amount: 1250, note: "хлеб" }, { id: "t2", amount: 500, note: "" }]);
  assert.equal(q("SELECT to_account_id FROM transactions WHERE id='t2'")[0].to_account_id, "card");
  assert.equal(q("SELECT limit_amount FROM budgets WHERE user_id='u1'")[0].limit_amount, 300000);
  assert.equal(q("SELECT deadline FROM goals WHERE user_id='u1'")[0].deadline, "2027-01-01");
  assert.equal(q("SELECT freq FROM recurring WHERE user_id='u1'")[0].freq, "yearly");
  assert.equal(q("SELECT COUNT(*) c FROM transactions WHERE user_id IN ('u2','u3')")[0].c, 0);
  assert.equal(q("SELECT COUNT(*) c FROM user_data")[0].c, 3, "старые данные сохранены");
});
