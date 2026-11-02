// Простой счётчик попыток в D1 (фиксированное окно).
export async function peek(env, key, limit, windowSec) {
  const now = Date.now();
  const row = await env.DB.prepare("SELECT count, window_start FROM rate_limits WHERE key=?1").bind(key).first();
  if (!row || row.window_start <= now - windowSec * 1000 || row.count < limit) return { limited: false };
  return { limited: true, retryAfter: Math.max(1, Math.ceil((row.window_start + windowSec * 1000 - now) / 1000)) };
}
export async function hit(env, key, windowSec) {
  const now = Date.now(), cutoff = now - windowSec * 1000;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits(key,window_start,count) VALUES(?1,?2,1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
     RETURNING count, window_start`
  ).bind(key, now, cutoff).first();
  return { count: row.count, retryAfter: Math.max(1, Math.ceil((row.window_start + windowSec * 1000 - now) / 1000)) };
}
export async function clear(env, key) { await env.DB.prepare("DELETE FROM rate_limits WHERE key=?1").bind(key).run(); }
