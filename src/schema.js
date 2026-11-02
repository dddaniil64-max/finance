// Общее описание таблиц: используется Worker-ом (бэкап) и скриптом восстановления.
export const BACKUP_VERSION = 3;
export const BACKUP_TABLES = {
  users: { userCol: "id", cols: ["id", "email", "name", "password_salt", "password_hash", "password_iter", "created_at"] },
  user_settings: { userCol: "user_id", cols: ["user_id", "currency", "theme", "migrated_at", "updated_at"] },
  accounts: { userCol: "user_id", cols: ["user_id", "id", "name", "type", "start_balance", "position"] },
  categories: { userCol: "user_id", cols: ["user_id", "id", "name", "type", "icon", "color", "position"] },
  transactions: { userCol: "user_id", cols: ["user_id", "id", "type", "amount", "date", "category_id", "account_id", "to_account_id", "note", "ts"] },
  budgets: { userCol: "user_id", cols: ["user_id", "category_id", "limit_amount", "position"] },
  goals: { userCol: "user_id", cols: ["user_id", "id", "name", "target", "saved", "deadline", "position"] },
  recurring: { userCol: "user_id", cols: ["user_id", "id", "type", "amount", "category_id", "account_id", "freq", "next_date", "note", "position"] },
};
// Порядок вставки (родитель → потомки). Для очистки используется обратный порядок.
export const BACKUP_ORDER = ["users", "user_settings", "accounts", "categories", "transactions", "budgets", "goals", "recurring"];
