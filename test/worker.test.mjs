import test from "node:test";
import assert from "node:assert/strict";
import { createEnv, createClient, register, PASSWORD, mockResend } from "./helpers/app.mjs";

const count = (env, table, where = "1=1") => env.DB.raw.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`).get().c;

test("регистрация создаёт пользователя, хеш PBKDF2 и стартовые данные в отдельных таблицах", async () => {
  const env = createEnv(), c = createClient(env);
  const r = await register(c);
  assert.equal(r.status, 201);
  const u = env.DB.raw.prepare("SELECT * FROM users").get();
  assert.notEqual(u.password_hash, PASSWORD);
  assert.equal(u.password_hash.length, 64);
  assert.equal(u.password_iter, 100000);
  assert.equal(count(env, "accounts"), 2);
  assert.equal(count(env, "categories"), 9);
  const st = await c.get("/api/state");
  assert.equal(st.data.state.accounts.length, 2);
  assert.equal(st.data.state.settings.currency, "RUB");
  assert.equal((await c.get("/api/auth/me")).data.user.email, "anna@example.com");
});

test("пароль короче 10 символов и дубликат email отклоняются", async () => {
  const env = createEnv(), c = createClient(env);
  assert.equal((await c.post("/api/auth/register", { email: "a@b.co", password: "short" })).status, 400);
  assert.equal((await register(c)).status, 201);
  assert.equal((await register(createClient(env, "198.51.100.1"))).status, 409);
});

test("сохранение состояния пишет по таблицам и синхронизирует изменения и удаления", async () => {
  const env = createEnv(), c = createClient(env);
  await register(c);
  const state = (await c.get("/api/state")).data.state;
  state.tx = [
    { id: "t1", type: "income", amount: 500000, date: "2026-11-01", cat: "salary", acc: "card", to: "", note: "Аванс", ts: 1 },
    { id: "t2", type: "expense", amount: 12050, date: "2026-11-02", cat: "food", acc: "card", to: "", note: "Магазин", ts: 2 },
    { id: "t3", type: "transfer", amount: 1000, date: "2026-11-02", cat: "", acc: "card", to: "cash", note: "", ts: 3 },
  ];
  state.budgets = [{ cat: "food", limit: 3000000 }];
  state.goals = [{ id: "g1", name: "Отпуск", target: 10000000, saved: 0, deadline: "2027-06-01" }];
  state.recurring = [{ id: "r1", type: "expense", amount: 50000, cat: "home", acc: "card", freq: "monthly", next: "2026-12-01", note: "Интернет" }];
  state.settings.currency = "EUR";
  assert.equal((await c.put("/api/state", { state })).status, 200);
  assert.equal(count(env, "transactions"), 3);
  assert.equal(count(env, "budgets"), 1);
  assert.equal(count(env, "goals"), 1);
  assert.equal(count(env, "recurring"), 1);

  const back = (await c.get("/api/state")).data.state;
  assert.deepEqual(back.tx.map((t) => t.id).sort(), ["t1", "t2", "t3"]);
  assert.equal(back.settings.currency, "EUR");
  assert.deepEqual(back.recurring[0], state.recurring[0]);

  // изменить одну операцию, удалить другую
  back.tx.find((t) => t.id === "t2").amount = 99900;
  back.tx = back.tx.filter((t) => t.id !== "t3");
  await c.put("/api/state", { state: back });
  assert.equal(count(env, "transactions"), 2);
  assert.equal(env.DB.raw.prepare("SELECT amount FROM transactions WHERE id='t2'").get().amount, 99900);

  // очистка всех данных (кнопка «Очистить»)
  await c.put("/api/state", { state: { settings: back.settings, accounts: back.accounts, categories: back.categories, tx: [], budgets: [], goals: [], recurring: [] } });
  assert.equal(count(env, "transactions"), 0);
  assert.equal(count(env, "goals"), 0);
});

test("большое состояние (3000 операций) сохраняется и читается без потерь", async () => {
  const env = createEnv(), c = createClient(env);
  await register(c);
  const state = (await c.get("/api/state")).data.state;
  state.tx = Array.from({ length: 3000 }, (_, i) => ({ id: "x" + i, type: "expense", amount: 100 + i, date: `2026-0${1 + (i % 9)}-1${i % 10}`, cat: "food", acc: "cash", to: "", note: `покупка №${i} ' "кавычки" 🙂`, ts: i }));
  assert.equal((await c.put("/api/state", { state })).status, 200);
  const back = (await c.get("/api/state")).data.state;
  assert.equal(back.tx.length, 3000);
  assert.equal(back.tx.find((t) => t.id === "x42").note, `покупка №42 ' "кавычки" 🙂`);
});

test("данные пользователей изолированы", async () => {
  const env = createEnv(), a = createClient(env, "10.0.0.1"), b = createClient(env, "10.0.0.2");
  await register(a, "a@example.com"); await register(b, "b@example.com");
  const sa = (await a.get("/api/state")).data.state;
  sa.tx = [{ id: "secret", type: "income", amount: 100, date: "2026-11-01", cat: "salary", acc: "cash", to: "", note: "A", ts: 1 }];
  await a.put("/api/state", { state: sa });
  // у B может быть операция с тем же id — это не конфликт и не утечка
  const sb = (await b.get("/api/state")).data.state;
  sb.tx = [{ id: "secret", type: "expense", amount: 5, date: "2026-11-01", cat: "food", acc: "cash", to: "", note: "B", ts: 1 }];
  assert.equal((await b.put("/api/state", { state: sb })).status, 200);
  assert.equal((await a.get("/api/state")).data.state.tx[0].note, "A");
  assert.equal((await b.get("/api/state")).data.state.tx[0].note, "B");
  assert.equal((await createClient(env).get("/api/state")).status, 401);
});

test("некорректные данные отклоняются и ничего не портят", async () => {
  const env = createEnv(), c = createClient(env);
  await register(c);
  const good = (await c.get("/api/state")).data.state;
  const bad = [
    { ...good, tx: [{ id: "1", type: "bogus", amount: 1, date: "2026-01-01" }] },
    { ...good, tx: [{ id: "1", type: "income", amount: "abc", date: "2026-01-01" }] },
    { ...good, tx: [{ id: "1", type: "income", amount: 1, date: "вчера" }] },
    { ...good, tx: [{ type: "income", amount: 1, date: "2026-01-01" }] },
    { ...good, accounts: "nope" },
  ];
  for (const state of bad) assert.equal((await c.put("/api/state", { state })).status, 400);
  assert.equal((await c.put("/api/state", "{not json")).status, 400);
  assert.equal((await c.put("/api/state", { state: [] })).status, 400);
  assert.equal(count(env, "transactions"), 0);
  assert.equal(count(env, "accounts"), 2);
});

test("запрос с чужим Origin на изменение отклоняется", async () => {
  const env = createEnv(), c = createClient(env);
  assert.equal((await c.call("POST", "/api/auth/login", { email: "a@b.co", password: "x" }, { Origin: "https://evil.example" })).status, 403);
});

test("вход: неверный пароль → 401, после 8 неудач блокировка 429, успех сбрасывает счётчик", async () => {
  const env = createEnv(), c = createClient(env);
  await register(c, "lock@example.com");
  const attacker = createClient(env, "192.0.2.7");
  for (let i = 0; i < 8; i++) assert.equal((await attacker.post("/api/auth/login", { email: "lock@example.com", password: "wrong-password-" + i })).status, 401);
  const blocked = await attacker.post("/api/auth/login", { email: "lock@example.com", password: PASSWORD });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);

  const env2 = createEnv(), u = createClient(env2, "192.0.2.8");
  await register(u, "ok@example.com");
  for (let i = 0; i < 5; i++) await u.post("/api/auth/login", { email: "ok@example.com", password: "wrong-password-" + i });
  assert.equal((await u.post("/api/auth/login", { email: "ok@example.com", password: PASSWORD })).status, 200);
  assert.equal(count(env2, "rate_limits", "key LIKE 'login:email:%'"), 0);
});

test("несуществующий email и неверный пароль дают одинаковый ответ", async () => {
  const env = createEnv(), c = createClient(env);
  await register(c, "real@example.com");
  const a = await createClient(env, "1.1.1.1").post("/api/auth/login", { email: "real@example.com", password: "wrong-password" });
  const b = await createClient(env, "1.1.1.2").post("/api/auth/login", { email: "ghost@example.com", password: "wrong-password" });
  assert.equal(a.status, 401); assert.equal(b.status, 401);
  assert.deepEqual(a.data, b.data);
});

test("регистрация ограничена по IP (10 в час)", async () => {
  const env = createEnv(), c = createClient(env, "198.18.0.1");
  for (let i = 0; i < 10; i++) assert.equal((await c.post("/api/auth/register", { email: `u${i}@example.com`, password: PASSWORD })).status, 201);
  assert.equal((await c.post("/api/auth/register", { email: "u10@example.com", password: PASSWORD })).status, 429);
});

test("восстановление пароля: письмо через Resend, одноразовый токен, смена пароля, отзыв сессий", async () => {
  const mail = mockResend();
  try {
    const env = createEnv(), c = createClient(env);
    await register(c, "reset@example.com", "Ирина");
    const forgot = await createClient(env).post("/api/auth/forgot", { email: "reset@example.com" });
    assert.equal(forgot.status, 200);
    assert.equal(mail.sent.length, 1);
    const m = mail.sent[0];
    assert.equal(m.headers.authorization, "Bearer re_test");
    assert.deepEqual(m.body.to, ["reset@example.com"]);
    const token = m.body.text.match(/\?reset=([\w-]+)/)[1];
    assert.ok(m.body.text.includes("https://finance.example/?reset="));
    // в базе только хеш токена
    const row = env.DB.raw.prepare("SELECT token_hash FROM password_reset_tokens").get();
    assert.notEqual(row.token_hash, token);
    assert.equal(row.token_hash.length, 64);

    assert.equal((await createClient(env).post("/api/auth/reset", { token, password: "short" })).status, 400);
    const ok = await createClient(env).post("/api/auth/reset", { token, password: "brand-new-password" });
    assert.equal(ok.status, 200);
    // токен одноразовый
    assert.equal((await createClient(env).post("/api/auth/reset", { token, password: "another-password-1" })).status, 400);
    // старая сессия отозвана, старый пароль не работает, новый работает
    assert.equal((await c.get("/api/auth/me")).data.user, null);
    assert.equal((await createClient(env, "9.9.9.9").post("/api/auth/login", { email: "reset@example.com", password: PASSWORD })).status, 401);
    assert.equal((await createClient(env, "9.9.9.9").post("/api/auth/login", { email: "reset@example.com", password: "brand-new-password" })).status, 200);
  } finally { mail.restore(); }
});

test("сброс пароля: неизвестный email — тот же ответ и без письма; просроченный и поддельный токены не работают; лимит запросов", async () => {
  const mail = mockResend();
  try {
    const env = createEnv(), c = createClient(env);
    await register(c, "known@example.com");
    const known = await createClient(env, "5.5.5.1").post("/api/auth/forgot", { email: "known@example.com" });
    const unknown = await createClient(env, "5.5.5.2").post("/api/auth/forgot", { email: "nobody@example.com" });
    assert.deepEqual(known.data, unknown.data);
    assert.equal(mail.sent.length, 1);

    const token = mail.sent[0].body.text.match(/\?reset=([\w-]+)/)[1];
    env.DB.raw.prepare("UPDATE password_reset_tokens SET expires_at=?").run(Date.now() - 1000);
    assert.equal((await createClient(env).post("/api/auth/reset", { token, password: "brand-new-password" })).status, 400);
    assert.equal((await createClient(env).post("/api/auth/reset", { token: "forged", password: "brand-new-password" })).status, 400);

    // не больше 3 писем в час на один адрес
    const spam = createClient(env, "5.5.5.3");
    for (let i = 0; i < 6; i++) await spam.post("/api/auth/forgot", { email: "known@example.com" });
    assert.ok(mail.sent.length <= 3);
  } finally { mail.restore(); }
});

test("если Resend недоступен, пользователь всё равно получает нейтральный ответ", async () => {
  const env = createEnv({ RESEND_API_KEY: undefined }), c = createClient(env);
  await register(c, "nomail@example.com");
  const r = await createClient(env, "7.7.7.7").post("/api/auth/forgot", { email: "nomail@example.com" });
  assert.equal(r.status, 200);
});

test("выход удаляет сессию; профиль меняется", async () => {
  const env = createEnv(), c = createClient(env);
  await register(c);
  assert.equal((await c.call("PATCH", "/api/auth/profile", { name: "Новое имя" })).data.user.name, "Новое имя");
  await c.post("/api/auth/logout", {});
  assert.equal(count(env, "sessions"), 0);
});
