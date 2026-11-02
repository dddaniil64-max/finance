import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const read = (p) => readFile(new URL("../" + p, import.meta.url), "utf8");

test("wrangler.toml: D1, R2, cron и assets настроены", async () => {
  const t = await read("wrangler.toml");
  assert.match(t, /binding = "DB"/); assert.match(t, /binding = "BACKUPS"/); assert.match(t, /crons = \["0 3 \* \* \*"\]/);
  assert.match(t, /run_worker_first = \["\/api\/\*"\]/); assert.match(t, /MAIL_FROM/);
});
test("GitHub Actions: CI, тесты → миграции → deploy", async () => {
  assert.ok((await readdir(new URL("../.github/workflows/", import.meta.url))).includes("ci.yml"));
  const d = await read(".github/workflows/deploy.yml");
  assert.match(d, /npm test/);
  assert.ok(d.indexOf("d1 migrations apply") < d.indexOf("command: deploy"), "миграции раньше публикации");
  assert.match(d, /needs: test/);
});
test("в репозитории нет секретов", async () => {
  for (const f of ["wrangler.toml", "src/api.js", "src/mail.js", ".github/workflows/deploy.yml"]) assert.doesNotMatch(await read(f), /re_[A-Za-z0-9]{20,}/);
});
