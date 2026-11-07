// Telegram-бот Cavalla (grammy). Вебхук-режим: botInfo читаем лениво, внутри хендлеров (§37).
import { Bot } from "grammy";
import type { Env } from "./types";

export async function bootstrap(env: Env, origin: string): Promise<Response> {
  const token = env.BOT_TOKEN;
  const tg = (method: string, body: object) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json() as Promise<any>);

  const me = await tg("getMe", {});
  if (!me.ok) {
    return Response.json({ ok: false, step: "getMe", error: me.description }, { status: 502 });
  }
  const hook = await tg("setWebhook", {
    url: `${origin}/tg/${env.WEBHOOK_SECRET}`,
    secret_token: env.WEBHOOK_SECRET,
    drop_pending_updates: true,
  });
  const info = await tg("getWebhookInfo", {});
  return Response.json({
    ok: hook.ok,
    bot: me.result?.username,
    bot_id: me.result?.id,
    webhook_url_after: info.result?.url ?? "",
    webhook_ok: hook.ok,
  });
}

export async function botHandler(req: Request, env: Env): Promise<Response> {
  try {
    // std/http адаптер грамми ждёт { request } — но в воркерах проще напрямую:
    // сами парсим апдейт и зовём handleUpdate, формат ответа Telegram не важен (§39).
    const secret = req.headers.get("x-telegram-bot-api-secret-token");
    if (secret !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }
    const update = await req.json();
    const bot = createBot(env);
    // грамми требует botInfo до handleUpdate; init() зовёт getMe из CF-датацентра
    try { await bot.init(); } catch { /* init уже прошёл — продолжаем */ }
    try {
      await bot.handleUpdate(update);
    } catch (e) {
      // ошибка доставки к несуществующему chat (фейковые пробы) — не роняем вебхук (§56)
      console.error("handleUpdate:", String(e));
    }
    return Response.json({ ok: true, handled: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    return Response.json({ ok: false, debug_error: String(msg).slice(0, 600) }, { status: 500 });
  }
}

let cached: Bot | null = null;
function createBot(env: Env): Bot {
  if (cached) return cached;
  const bot = new Bot(env.BOT_TOKEN);
  bot.catch((err) => {
    console.error("bot error", err.error);
  });
  bot.command("start", async (ctx) => {
    // регистрация юзера при первом контакте
    const u = ctx.from;
    if (!u) return;
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO users (id, username, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET last_seen_at = ?, username = ?`
    )
      .bind(u.id, u.username ?? null, now, now, now, u.username ?? null)
      .run();
    await ctx.reply(
      "Привет! Это Cavalla — календарь течки твоей собаки.\n\nОткрой мини-приложение кнопкой ниже: отмети начало течки, веди дневник симптомов, а Cavalla будет предсказывать следующие циклы.",
      {
        reply_markup: env.MINIAPP_URL
          ? { inline_keyboard: [[{ text: "🐶 Открыть Cavalla", web_app: { url: env.MINIAPP_URL } }]] }
          : undefined,
      }
    );
  });
  cached = bot;
  return bot;
}
