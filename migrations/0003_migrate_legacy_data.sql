-- Перенос данных из старого формата (user_data.state_json) в отдельные таблицы.
-- Безопасно при повторном запуске (INSERT OR IGNORE). Исходная user_data не изменяется.
-- Строки без id / с неверным типом или датой пропускаются, но остаются в user_data.

INSERT OR IGNORE INTO user_settings(user_id, currency, theme, migrated_at, updated_at)
SELECT u.id,
 CASE WHEN json_extract(s.j,'$.settings.currency') IN ('RUB','EUR','USD','GBP') THEN json_extract(s.j,'$.settings.currency') ELSE 'RUB' END,
 CASE WHEN json_extract(s.j,'$.settings.theme') IN ('light','dark') THEN json_extract(s.j,'$.settings.theme') ELSE 'light' END,
 CAST(strftime('%s','now') AS INTEGER) * 1000,
 COALESCE(s.updated_at, CAST(strftime('%s','now') AS INTEGER) * 1000)
FROM users u
LEFT JOIN (SELECT user_id, updated_at, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s ON s.user_id = u.id
WHERE s.j IS NOT NULL;

INSERT OR IGNORE INTO accounts(user_id, id, name, type, start_balance, position)
SELECT s.user_id,
 CAST(json_extract((CASE WHEN a.type = 'object' THEN a.value ELSE '{}' END),'$.id') AS TEXT),
 COALESCE(NULLIF(substr(CAST(json_extract((CASE WHEN a.type = 'object' THEN a.value ELSE '{}' END),'$.name') AS TEXT),1,80),''),'Счёт'),
 CASE WHEN json_extract((CASE WHEN a.type = 'object' THEN a.value ELSE '{}' END),'$.type') IN ('cash','card','savings','other') THEN json_extract((CASE WHEN a.type = 'object' THEN a.value ELSE '{}' END),'$.type') ELSE 'other' END,
 CAST(ROUND(COALESCE(json_extract((CASE WHEN a.type = 'object' THEN a.value ELSE '{}' END),'$.start'),0)) AS INTEGER),
 a.key
FROM (SELECT user_id, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s
JOIN users u ON u.id = s.user_id,
 json_each(s.j,'$.accounts') a
WHERE json_type(s.j,'$.accounts') = 'array' AND a.type = 'object'
 AND json_extract((CASE WHEN a.type = 'object' THEN a.value ELSE '{}' END),'$.id') IS NOT NULL;

INSERT OR IGNORE INTO categories(user_id, id, name, type, icon, color, position)
SELECT s.user_id,
 CAST(json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.id') AS TEXT),
 COALESCE(NULLIF(substr(CAST(json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.name') AS TEXT),1,80),''),'Категория'),
 json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.type'),
 COALESCE(substr(CAST(json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.icon') AS TEXT),1,16),''),
 COALESCE(substr(CAST(json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.color') AS TEXT),1,16),'#9ba4b8'),
 c.key
FROM (SELECT user_id, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s
JOIN users u ON u.id = s.user_id,
 json_each(s.j,'$.categories') c
WHERE json_type(s.j,'$.categories') = 'array' AND c.type = 'object'
 AND json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.id') IS NOT NULL
 AND json_extract((CASE WHEN c.type = 'object' THEN c.value ELSE '{}' END),'$.type') IN ('income','expense');

INSERT OR IGNORE INTO transactions(user_id, id, type, amount, date, category_id, account_id, to_account_id, note, ts)
SELECT s.user_id,
 CAST(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.id') AS TEXT),
 json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.type'),
 CAST(ROUND(COALESCE(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.amount'),0)) AS INTEGER),
 json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.date'),
 COALESCE(CAST(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.cat') AS TEXT),''),
 COALESCE(CAST(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.acc') AS TEXT),''),
 COALESCE(CAST(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.to') AS TEXT),''),
 COALESCE(substr(CAST(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.note') AS TEXT),1,500),''),
 CAST(ROUND(COALESCE(json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.ts'),0)) AS INTEGER)
FROM (SELECT user_id, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s
JOIN users u ON u.id = s.user_id,
 json_each(s.j,'$.tx') t
WHERE json_type(s.j,'$.tx') = 'array' AND t.type = 'object'
 AND json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.id') IS NOT NULL
 AND json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.type') IN ('income','expense','transfer')
 AND json_extract((CASE WHEN t.type = 'object' THEN t.value ELSE '{}' END),'$.date') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';

INSERT OR IGNORE INTO budgets(user_id, category_id, limit_amount, position)
SELECT s.user_id,
 CAST(json_extract((CASE WHEN b.type = 'object' THEN b.value ELSE '{}' END),'$.cat') AS TEXT),
 CAST(ROUND(COALESCE(json_extract((CASE WHEN b.type = 'object' THEN b.value ELSE '{}' END),'$.limit'),0)) AS INTEGER),
 b.key
FROM (SELECT user_id, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s
JOIN users u ON u.id = s.user_id,
 json_each(s.j,'$.budgets') b
WHERE json_type(s.j,'$.budgets') = 'array' AND b.type = 'object'
 AND json_extract((CASE WHEN b.type = 'object' THEN b.value ELSE '{}' END),'$.cat') IS NOT NULL;

INSERT OR IGNORE INTO goals(user_id, id, name, target, saved, deadline, position)
SELECT s.user_id,
 CAST(json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.id') AS TEXT),
 COALESCE(NULLIF(substr(CAST(json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.name') AS TEXT),1,80),''),'Цель'),
 CAST(ROUND(COALESCE(json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.target'),0)) AS INTEGER),
 CAST(ROUND(COALESCE(json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.saved'),0)) AS INTEGER),
 CASE WHEN json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.deadline') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.deadline') ELSE '' END,
 g.key
FROM (SELECT user_id, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s
JOIN users u ON u.id = s.user_id,
 json_each(s.j,'$.goals') g
WHERE json_type(s.j,'$.goals') = 'array' AND g.type = 'object'
 AND json_extract((CASE WHEN g.type = 'object' THEN g.value ELSE '{}' END),'$.id') IS NOT NULL;

INSERT OR IGNORE INTO recurring(user_id, id, type, amount, category_id, account_id, freq, next_date, note, position)
SELECT s.user_id,
 CAST(json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.id') AS TEXT),
 json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.type'),
 CAST(ROUND(COALESCE(json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.amount'),0)) AS INTEGER),
 COALESCE(CAST(json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.cat') AS TEXT),''),
 COALESCE(CAST(json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.acc') AS TEXT),''),
 CASE WHEN json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.freq') IN ('weekly','monthly','yearly') THEN json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.freq') ELSE 'monthly' END,
 CASE WHEN json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.next') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.next') ELSE '' END,
 COALESCE(substr(CAST(json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.note') AS TEXT),1,500),''),
 r.key
FROM (SELECT user_id, CASE WHEN json_valid(state_json) THEN state_json ELSE '{}' END AS j FROM user_data) s
JOIN users u ON u.id = s.user_id,
 json_each(s.j,'$.recurring') r
WHERE json_type(s.j,'$.recurring') = 'array' AND r.type = 'object'
 AND json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.id') IS NOT NULL
 AND json_extract((CASE WHEN r.type = 'object' THEN r.value ELSE '{}' END),'$.type') IN ('income','expense');
