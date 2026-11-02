# FINANCE 3.0 — личные финансы на Cloudflare Workers + D1

Многопользовательский финансовый сайт: Worker с API, данные в отдельных SQL-таблицах D1, ежедневные бэкапы в R2, письма через Resend.

## Что нового в 3.0
- Отдельные таблицы D1: `accounts`, `categories`, `transactions`, `budgets`, `goals`, `recurring`, `user_settings` (у каждой строки есть `user_id`).
- Регистрация/вход, пароли PBKDF2-SHA-256 (100 000 итераций — максимум, который разрешает WebCrypto в Workers).
- Восстановление пароля через Resend: токен одноразовый, живёт 1 час, в базе лежит только его хеш; после смены пароля все сессии завершаются.
- Ограничение попыток: вход — 8 неудач на email и 30 на IP за 15 мин; регистрация — 10 в час на IP; сброс пароля — 3 письма в час на адрес.
- Ежедневный бэкап в Cloudflare R2 (03:00 UTC), хранятся последние 30 копий.
- `scripts/backup-to-sql.mjs` — превращает копию в SQL для восстановления.
- Перенос данных из прежнего формата (`user_data`) — миграция `0003`, выполняется автоматически.
- GitHub Actions: тесты → миграции D1 → публикация.
- Интерфейс FINANCE сохранён.

## Первый запуск (один раз)
1. **GitHub.** Создайте репозиторий, загрузите содержимое папки (файл `wrangler.toml` — в корне), ветка `main`.
2. **D1.** `npx wrangler d1 create finance-manager-db` (или в панели Cloudflare). Скопируйте Database ID в `wrangler.toml` вместо `PASTE_YOUR_D1_DATABASE_ID_HERE`.
3. **R2.** `npm run r2:create` (бакет `finance-manager-backups`, оставьте приватным — в копиях лежат хеши паролей).
4. **Resend.** Подтвердите домен, создайте API-ключ. В `wrangler.toml` укажите `MAIL_FROM` (адрес на вашем домене) и `APP_URL` (адрес сайта). Ключ добавьте как секрет: `npx wrangler secret put RESEND_API_KEY`.
5. **Секреты GitHub** (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN` (права: Workers Scripts:Edit, D1:Edit, Workers R2 Storage:Edit) и `CLOUDFLARE_ACCOUNT_ID`.
6. Сделайте commit в `main` — Actions прогонит тесты, применит миграции и опубликует Worker.

Публикуйте **только одним способом**: через GitHub Actions *или* через Git-интеграцию Cloudflare, иначе деплои будут дублироваться.

## Локально
```bash
npm install
npm test                 # 34 теста, нужен Node 22.13+
npm run dev:local        # сайт на http://localhost:4199 без Cloudflare (БД в памяти, письма не уходят)
npm run db:migrate:local && npm run dev   # настоящий wrangler dev
```

## Обновление существующей базы (2.0 → 3.0)
`npm run db:migrate:remote` (или просто push в `main`) применит `0002` (таблицы) и `0003` (перенос данных). Старая таблица `user_data` **не удаляется** — это страховка для отката. Строки без id, с неверным типом или датой при переносе пропускаются (в `user_data` они остаются). Удалить `user_data` можно позже отдельной миграцией, когда убедитесь, что всё на месте.

## Восстановление из бэкапа
1. Скачайте файл из R2: `npx wrangler r2 object get finance-manager-backups/backups/<файл>.json.gz --file backup.json.gz --remote`.
2. Преобразуйте в SQL:
   ```bash
   node scripts/backup-to-sql.mjs backup.json.gz restore.sql --wipe                    # вся база
   node scripts/backup-to-sql.mjs backup.json.gz restore.sql --wipe --user me@mail.ru  # один пользователь
   ```
   Без `--wipe` строки добавляются/перезаписываются поверх текущих (`INSERT OR REPLACE`).
3. Выполните: `npx wrangler d1 execute finance-manager-db --remote --file restore.sql`.

Проверить cron вручную: `npx wrangler dev --test-scheduled`, затем `curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"`.

## API
`GET /api/health` · `POST /api/auth/register|login|logout|forgot|reset` · `GET /api/auth/me` · `PATCH /api/auth/profile` · `GET|PUT /api/state`

`PUT /api/state` принимает полное состояние, но в базу пишет только отличия от сохранённого (вставки/обновления/удаления по таблицам).

## Известные ограничения
- Синхронизация по принципу «последняя запись побеждает»: если один аккаунт одновременно редактируют с двух устройств, правки того, кто сохранил раньше, могут быть перезаписаны. Следующий шаг — отдельные эндпоинты на каждую сущность.
- Блокировка входа считается по email: злоумышленник может временно заблокировать чужой вход (на 15 мин), но не подобрать пароль.
- Бэкап собирается в памяти Worker-а и подходит для баз до нескольких десятков МБ; для больших объёмов нужен потоковый экспорт.
- Данные во время работы бэкапа читаются страницами, а не единым снимком, поэтому копия может не отражать одну точную секунду.
