const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function sendResetEmail(env, { to, name, link }) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY не настроен");
  const from = env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM не настроен");
  const text = `Здравствуйте, ${name}!\n\nМы получили запрос на восстановление пароля FINANCE. Откройте ссылку, чтобы задать новый пароль (действует 1 час, работает один раз):\n\n${link}\n\nЕсли вы не запрашивали сброс, просто проигнорируйте письмо — пароль не изменится.`;
  const html = `<p>Здравствуйте, ${esc(name)}!</p><p>Мы получили запрос на восстановление пароля FINANCE. Ссылка действует 1 час и работает один раз.</p><p><a href="${esc(link)}">Задать новый пароль</a></p><p style="color:#777">Если вы не запрашивали сброс, просто проигнорируйте письмо — пароль не изменится.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from, to: [to], subject: "FINANCE — восстановление пароля", text, html }),
  });
  if (!res.ok) throw new Error(`Resend ответил статусом ${res.status}`);
}
