import { handleApi } from "./api.js";
import { runScheduled } from "./backup.js";
import { HttpError, json } from "./util.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, ctx); }
      catch (e) {
        if (e instanceof HttpError) return json({ error: e.message }, e.status, e.headers);
        console.error("API error", e);
        return json({ error: "Внутренняя ошибка сервера" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runScheduled(env)); },
};
