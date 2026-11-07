// Cavalla — Telegram Mini App: календарь течки собак.
// Воркер: вебхук Telegram + API мини-аппа + статика мини-аппа + крон уведомлений.
import { botHandler, bootstrap } from "./bot";
import { handleApi } from "./api";
import { runDailyNotifications } from "./notify";
import type { Env, ScheduledEvent, ExecutionContext } from "./types";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return Response.json({ ok: true, name: "cavalla-api" });
    }

    // /cron?secret=...: ручной запуск дневных уведомлений (тот же код, что scheduled)
    if (path === "/cron") {
      if (url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      const r = await runDailyNotifications(env);
      return Response.json({ ok: true, ...r });
    }

    // /bootstrap?secret=...: ставит вебхук (воркер зовёт Telegram из CF-датацентра).
    if (path === "/bootstrap") {
      if (url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      return bootstrap(env, url.origin);
    }

    // вебхук Telegram: /tg/<secret>
    if (path.startsWith("/tg/")) {
      const secret = path.slice("/tg/".length);
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }
      return botHandler(req, env);
    }

    // API мини-аппа: /api/...
    if (path.startsWith("/api/")) {
      return handleApi(req, env, path);
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runDailyNotifications(env).catch(e => {
        // крон падает молча и никто не узнает — логируем всегда
        console.error("cron failed:", e instanceof Error ? e.stack : String(e));
      })
    );
  },
};
