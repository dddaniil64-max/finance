-- FINANCE 3.0: отдельные таблицы для данных, защита входа, сброс пароля.
-- Старая таблица user_data НЕ удаляется: она остаётся как страховка на случай отката.

ALTER TABLE users ADD COLUMN password_iter INTEGER NOT NULL DEFAULT 100000;

CREATE TABLE IF NOT EXISTS user_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 currency TEXT NOT NULL DEFAULT 'RUB',
 theme TEXT NOT NULL DEFAULT 'light',
 migrated_at INTEGER,
 updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 type TEXT NOT NULL DEFAULT 'other',
 start_balance INTEGER NOT NULL DEFAULT 0,
 position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS categories (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 type TEXT NOT NULL CHECK (type IN ('income','expense')),
 icon TEXT NOT NULL DEFAULT '',
 color TEXT NOT NULL DEFAULT '#9ba4b8',
 position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS transactions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 type TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
 amount INTEGER NOT NULL,
 date TEXT NOT NULL,
 category_id TEXT NOT NULL DEFAULT '',
 account_id TEXT NOT NULL DEFAULT '',
 to_account_id TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 ts INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);

CREATE TABLE IF NOT EXISTS budgets (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category_id TEXT NOT NULL,
 limit_amount INTEGER NOT NULL DEFAULT 0,
 position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, category_id)
);

CREATE TABLE IF NOT EXISTS goals (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 name TEXT NOT NULL,
 target INTEGER NOT NULL DEFAULT 0,
 saved INTEGER NOT NULL DEFAULT 0,
 deadline TEXT NOT NULL DEFAULT '',
 position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS recurring (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 id TEXT NOT NULL,
 type TEXT NOT NULL CHECK (type IN ('income','expense')),
 amount INTEGER NOT NULL DEFAULT 0,
 category_id TEXT NOT NULL DEFAULT '',
 account_id TEXT NOT NULL DEFAULT '',
 freq TEXT NOT NULL DEFAULT 'monthly',
 next_date TEXT NOT NULL DEFAULT '',
 note TEXT NOT NULL DEFAULT '',
 position INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_expiry ON password_reset_tokens(expires_at);

CREATE TABLE IF NOT EXISTS rate_limits (
 key TEXT PRIMARY KEY,
 window_start INTEGER NOT NULL,
 count INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
