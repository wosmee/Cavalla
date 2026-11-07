// API мини-аппа Cavalla: собаки, течки, чекины, прогноз, настройки. Всё авторизовано initData.
import { verifyInitData, type TgUser } from "./auth.ts";
import { computeCycleStatus } from "./cycle.ts";
import { dayMsk } from "./notify.ts";
import { resolveBreedProfile } from "./breeds.ts";
import { submitManualReport, submitErrorReport } from "./support.ts";
import type { Env } from "./types";

interface Row { notify_settings: string | null }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  // Authorization: Tg init-data заголовком
  const initData = req.headers.get("x-tg-init-data") ?? new URL(req.url).searchParams.get("init_data") ?? "";
  const user = await verifyInitData(env, initData);
  if (!user) return json({ ok: false, error: "unauthorized" }, 401);
  await touchUser(env, user);

  // --- настройки уведомлений (opt-in, JSON в users.notify_settings) ---
  if (path === "/api/me/notify" && req.method === "GET") {
    const r = await env.DB.prepare("SELECT notify_settings FROM users WHERE id = ?").bind(user.id).first<Row>();
    return json({ ok: true, notify: parseNotify(r) });
  }
  if (path === "/api/me/notify" && req.method === "PUT") {
    const body = await req.json().catch(() => null) as { notify?: unknown } | null;
    const bad = body?.notify === null || typeof body?.notify !== "object" || Array.isArray(body?.notify)
      || !Object.entries(body.notify as object).every(([k, v]) =>
        k === "enabled" || k === "day_of_heat" || k === "checkin_reminder"
          ? typeof v === "boolean"
          : k === "advance_days"
            ? Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 30
            : false);
    if (bad) return json({ ok: false, error: "bad notify" }, 400);
    const clean: Record<string, unknown> = {};
    const n = body.notify as Record<string, unknown>;
    if ("enabled" in n) clean.enabled = !!n.enabled;
    if ("advance_days" in n) clean.advance_days = Math.min(30, Math.max(1, Math.floor(n.advance_days as number)));
    if ("day_of_heat" in n) clean.day_of_heat = !!n.day_of_heat;
    if ("checkin_reminder" in n) clean.checkin_reminder = !!n.checkin_reminder;
    await env.DB.prepare("UPDATE users SET notify_settings = ? WHERE id = ?").bind(JSON.stringify(clean), user.id).run();
    return json({ ok: true, notify: clean });
  }

  // --- поддержка: жалоба (manual) или авто-репорт ошибки (error) ---
  if (path === "/api/reports" && req.method === "POST") {
    const body = await req.json().catch(() => null) as {
      kind?: string; text?: string; page?: string; bundle_ver?: string; dog_id?: number;
    } | null;
    const kind = body?.kind === "error" ? "error" : "manual";
    if (kind === "error") {
      await submitErrorReport(env, "error", { id: user.id, username: user.username },
        String(body?.text ?? ""), body?.page ?? null, body?.bundle_ver ?? null);
      return json({ ok: true });
    }
    const r = await submitManualReport(env, { id: user.id, username: user.username }, {
      text: String(body?.text ?? ""),
      page: body?.page ?? null,
      bundle_ver: body?.bundle_ver ?? null,
      dog_id: typeof body?.dog_id === "number" ? body.dog_id : null,
    });
    if (!r.ok) return json({ ok: false, error: r.error }, r.status);
    return json({ ok: true });
  }

  // --- собаки ---
  if (path === "/api/dogs" && req.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT d.id, d.name, d.breed, d.birth_date, d.weight_grams, d.archived,
              CASE WHEN a.dog_id IS NULL THEN 0 ELSE 1 END AS has_avatar,
              a.updated_at AS avatar_updated_at
       FROM dogs d LEFT JOIN dog_avatars a ON a.dog_id = d.id
       WHERE d.owner_id = ? AND d.archived = 0 ORDER BY d.id`
    ).bind(user.id).all();
    return json({ ok: true, dogs: rows.results });
  }
  if (path === "/api/dogs" && req.method === "POST") {
    const body = await req.json().catch(() => null) as { name?: string; breed?: string; birth_date?: string; weight_grams?: number } | null;
    if (!body?.name?.trim()) return json({ ok: false, error: "name required" }, 400);
    const name = body.name.trim().slice(0, 50);
    // двойной тап «Добавить»: та же собака у того же владельца в последнюю минуту —
    // возвращаем существующую (идемпотентно), а не плодим копию
    const dup = await env.DB.prepare(
      "SELECT id FROM dogs WHERE owner_id = ? AND name = ? AND archived = 0 AND created_at >= ?"
    ).bind(user.id, name, new Date(Date.now() - 60_000).toISOString()).first<{ id: number } | null>();
    if (dup) {
      const dog = await env.DB.prepare(
        `SELECT d.id, d.name, d.breed, d.birth_date, d.weight_grams, d.archived,
                CASE WHEN a.dog_id IS NULL THEN 0 ELSE 1 END AS has_avatar,
                a.updated_at AS avatar_updated_at
         FROM dogs d LEFT JOIN dog_avatars a ON a.dog_id = d.id WHERE d.id = ?`
      ).bind(dup.id).first();
      return json({ ok: true, dog });
    }
    const r = await env.DB.prepare(
      "INSERT INTO dogs (owner_id, name, breed, birth_date, weight_grams, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(user.id, name, body.breed?.slice(0, 50) ?? null,
            body.birth_date ?? null, body.weight_grams ?? null, new Date().toISOString()).run();
    const dog = await env.DB.prepare(
      "SELECT id, name, breed, birth_date, weight_grams, archived, 0 AS has_avatar, NULL AS avatar_updated_at FROM dogs WHERE id = ?"
    ).bind(r.meta?.last_row_id).first();
    return json({ ok: true, dog });
  }
  const dogMatch = path.match(/^\/api\/dogs\/(\d+)(?:\/(.*))?$/);
  if (dogMatch) {
    const dogId = Number(dogMatch[1]);
    if (!(await ownDog(env, user.id, dogId))) return json({ ok: false, error: "not found" }, 404);
    const sub = dogMatch[2] ?? "";
    if (sub === "" && req.method === "PATCH") {
      const body = await req.json().catch(() => null) as Record<string, unknown> | null;
      if (!body) return json({ ok: false, error: "bad body" }, 400);
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const k of ["name", "breed", "birth_date", "weight_grams", "archived"] as const) {
        if (!(k in body)) continue;
        const v = body[k];
        // валидация по полям: в D1 без неё ляжет что угодно
        if (k === "name" || k === "breed") {
          if (typeof v !== "string" || !v.trim() || v.length > 50) {
            return json({ ok: false, error: `bad ${k}` }, 400);
          }
          sets.push(`${k} = ?`); vals.push(v.trim().slice(0, 50));
        } else if (k === "birth_date") {
          if (v !== null && (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v))) {
            return json({ ok: false, error: "bad birth_date" }, 400);
          }
          sets.push("birth_date = ?"); vals.push(v);
        } else if (k === "weight_grams") {
          if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 2000 || v > 90000)) {
            return json({ ok: false, error: "bad weight_grams" }, 400);
          }
          sets.push("weight_grams = ?"); vals.push(v);
        } else if (k === "archived") {
          if (typeof v !== "boolean") return json({ ok: false, error: "bad archived" }, 400);
          sets.push("archived = ?"); vals.push(v ? 1 : 0);
        }
      }
      if (!sets.length) return json({ ok: false, error: "nothing to update" }, 400);
      vals.push(dogId);
      await env.DB.batch([bumpCycleVersion(env, dogId), env.DB.prepare(`UPDATE dogs SET ${sets.join(", ")} WHERE id = ?`).bind(...vals)]);
      const dog = await env.DB.prepare(
        `SELECT d.id, d.name, d.breed, d.birth_date, d.weight_grams, d.archived,
                CASE WHEN a.dog_id IS NULL THEN 0 ELSE 1 END AS has_avatar,
                a.updated_at AS avatar_updated_at
         FROM dogs d LEFT JOIN dog_avatars a ON a.dog_id = d.id WHERE d.id = ?`
      ).bind(dogId).first();
      return json({ ok: true, dog });
    }
    if (sub === "" && req.method === "DELETE") {
      await env.DB.prepare("UPDATE dogs SET archived = 1 WHERE id = ?").bind(dogId).run();
      return json({ ok: true });
    }
    // --- аватар собаки: пользовательское фото (квадрат ≤256px, рисуется на клиенте) ---
    if (sub === "avatar" && req.method === "GET") {
      const row = await env.DB.prepare("SELECT mime, data_b64, updated_at FROM dog_avatars WHERE dog_id = ?").bind(dogId).first<{ mime: string; data_b64: string; updated_at: string } | null>();
      if (!row) return json({ ok: false, error: "no avatar" }, 404);
      const buf = Uint8Array.from(atob(row.data_b64), c => c.charCodeAt(0));
      // версионный кэш: URL строится с ?v=<updated_at мс> (GET /api/dogs отдаёт updated_at),
      // новое фото → новый URL → старый immutable-ответ не мешает
      return new Response(buf, { headers: { "content-type": row.mime, "cache-control": "private, max-age=86400, immutable" } });
    }
    if (sub === "avatar" && req.method === "PUT") {
      const body = await req.json().catch(() => null) as { mime?: string; data_b64?: string } | null;
      const mime = body?.mime;
      const b64 = body?.data_b64;
      if (mime !== "image/webp" && mime !== "image/jpeg" && mime !== "image/png") {
        return json({ ok: false, error: "bad mime" }, 400);
      }
      if (typeof b64 !== "string" || b64.length > 300_000) return json({ ok: false, error: "bad data" }, 400);
      if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return json({ ok: false, error: "bad base64" }, 400);
      await env.DB.prepare(
        `INSERT INTO dog_avatars (dog_id, mime, data_b64, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(dog_id) DO UPDATE SET mime = excluded.mime, data_b64 = excluded.data_b64, updated_at = excluded.updated_at`
      ).bind(dogId, mime, b64, new Date().toISOString()).run();
      return json({ ok: true });
    }
    if (sub === "avatar" && req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM dog_avatars WHERE dog_id = ?").bind(dogId).run();
      return json({ ok: true });
    }
    // --- течки ---
    if (sub === "heats" && req.method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, started_on, ended_on, note FROM heats WHERE dog_id = ? ORDER BY started_on"
      ).bind(dogId).all();
      return json({ ok: true, heats: rows.results });
    }
    if (sub === "heats" && req.method === "POST") {
      const body = await req.json().catch(() => null) as { started_on?: string; note?: string } | null;
      if (!body?.started_on || !/^\d{4}-\d{2}-\d{2}$/.test(body.started_on)) {
        return json({ ok: false, error: "started_on (YYYY-MM-DD) required" }, 400);
      }
      // нельзя начать новую течку, пока не закрыта предыдущая
      const open = await env.DB.prepare(
        "SELECT id FROM heats WHERE dog_id = ? AND ended_on IS NULL ORDER BY started_on DESC LIMIT 1"
      ).bind(dogId).first();
      if (open) return json({ ok: false, error: "heat already open" }, 409);
      // начало не раньше последнего записанного (закрытого) цикла
      const prev = await env.DB.prepare(
        "SELECT started_on FROM heats WHERE dog_id = ? ORDER BY started_on DESC LIMIT 1"
      ).bind(dogId).first<{ started_on: string } | null>();
      if (prev && body.started_on <= prev.started_on) {
        return json({ ok: false, error: "earlier than last heat" }, 400);
      }
      const r = await env.DB.batch([
        bumpCycleVersion(env, dogId),
        env.DB.prepare("INSERT INTO heats (dog_id, started_on, note, created_at) VALUES (?, ?, ?, ?)")
          .bind(dogId, body.started_on, body.note?.slice(0, 500) ?? null, new Date().toISOString()),
      ]);
      const heat = await env.DB.prepare("SELECT id, started_on, ended_on, note FROM heats WHERE id = ?").bind(r[1].meta?.last_row_id).first();
      return json({ ok: true, heat });
    }
    const heatMatch = sub.match(/^heats\/(\d+)$/);
    if (heatMatch) {
      const heatId = Number(heatMatch[1]);
      if (req.method === "PATCH") {
        const body = await req.json().catch(() => null) as { ended_on?: string | null; note?: string } | null;
        if (!body) return json({ ok: false, error: "bad body" }, 400);
        const sets: string[] = [];
        const vals: unknown[] = [];
        if ("ended_on" in body) {
          if (body.ended_on && !/^\d{4}-\d{2}-\d{2}$/.test(body.ended_on)) return json({ ok: false, error: "bad ended_on" }, 400);
          sets.push("ended_on = ?"); vals.push(body.ended_on ?? null);
        }
        if ("note" in body) { sets.push("note = ?"); vals.push(body.note?.slice(0, 500) ?? null); }
        if (!sets.length) return json({ ok: false, error: "nothing to update" }, 400);
        vals.push(heatId, dogId);
        await env.DB.batch([
          bumpCycleVersion(env, dogId),
          env.DB.prepare(`UPDATE heats SET ${sets.join(", ")} WHERE id = ? AND dog_id = ?`).bind(...vals),
        ]);
        const heat = await env.DB.prepare("SELECT id, started_on, ended_on, note FROM heats WHERE id = ?").bind(heatId).first();
        return json({ ok: true, heat });
      }
      if (req.method === "DELETE") {
        await env.DB.batch([
          bumpCycleVersion(env, dogId),
          env.DB.prepare("DELETE FROM heats WHERE id = ? AND dog_id = ?").bind(heatId, dogId),
        ]);
        return json({ ok: true });
      }
    }
    // --- прогноз цикла ---
    if (sub === "cycle" && req.method === "GET") {
      return json({ ok: true, status: await cycleStatus(env, dogId) });
    }
    // --- прошлые течки (прогрев истории) ---
    if (sub === "heats/backfill" && req.method === "POST") {
      // валидируем даты: от старых к новым, без открытой поверх открытой
      interface H { started_on?: string; ended_on?: string | null; note?: string }
      const body = await req.json().catch(() => null) as { heats?: H[] } | null;
      const list = body?.heats ?? [];
      if (!list.length) return json({ ok: false, error: "heats required" }, 400);
      const open = await env.DB.prepare(
        "SELECT id FROM heats WHERE dog_id = ? AND ended_on IS NULL LIMIT 1"
      ).bind(dogId).first();
      if (open) return json({ ok: false, error: "heat already open" }, 409);
      const prev = await env.DB.prepare(
        "SELECT started_on FROM heats WHERE dog_id = ? ORDER BY started_on DESC LIMIT 1"
      ).bind(dogId).first<{ started_on: string } | null>();
      const sorted = [...list].sort((a, b) => (a.started_on ?? "") < (b.started_on ?? "") ? -1 : 1);
      if (prev && (sorted[0].started_on ?? "") <= prev.started_on) {
        return json({ ok: false, error: "heats must be newer than existing" }, 400);
      }
      const created: unknown[] = [];
      const now = new Date().toISOString();
      // все вставки одним batch: падение посередине не должно оставлять половину истории
      // (+ bump версии собаки — инвалидация кэша цикла той же транзакцией)
      const stmts = [bumpCycleVersion(env, dogId)];
      for (const raw of sorted) {
        const s = raw.started_on ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return json({ ok: false, error: "bad started_on" }, 400);
        const e = raw.ended_on ?? null;
        if (e && (!/^\d{4}-\d{2}-\d{2}$/.test(e) || e < s)) return json({ ok: false, error: "bad ended_on" }, 400);
        stmts.push(env.DB.prepare(
          "INSERT INTO heats (dog_id, started_on, ended_on, note, created_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(dogId, s, e, raw.note?.slice(0, 500) ?? null, now));
      }
      await env.DB.batch(stmts);
      const from = sorted[0].started_on!;
      const to = sorted[sorted.length - 1].started_on!;
      const rows = (await env.DB.prepare(
        "SELECT id, started_on, ended_on, note FROM heats WHERE dog_id = ? AND started_on >= ? AND started_on <= ? ORDER BY started_on"
      ).bind(dogId, from, to).all()).results;
      return json({ ok: true, heats: rows });
    }
    // --- чекины ---
    if (sub === "checkins" && req.method === "GET") {
      const url = new URL(req.url);
      const from = url.searchParams.get("from") ?? "0000-01-01";
      const to = url.searchParams.get("to") ?? "9999-12-31";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return json({ ok: false, error: "bad range" }, 400);
      }
      const rows = await env.DB.prepare(
        "SELECT day, symptoms, note FROM daily_checkins WHERE dog_id = ? AND day >= ? AND day <= ? ORDER BY day"
      ).bind(dogId, from, to).all();
      return json({ ok: true, checkins: rows.results });
    }
    if (sub === "checkins" && req.method === "POST") {
      const body = await req.json().catch(() => null) as { day?: string; symptoms?: string[]; note?: string } | null;
      if (!body?.day || !/^\d{4}-\d{2}-\d{2}$/.test(body.day)) return json({ ok: false, error: "day required" }, 400);
      const symptoms = JSON.stringify((body.symptoms ?? []).filter(s => typeof s === "string").slice(0, 20));
      const now = new Date().toISOString();
      await env.DB.batch([
        bumpCycleVersion(env, dogId),
        env.DB.prepare(
          `INSERT INTO daily_checkins (dog_id, day, symptoms, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(dog_id, day) DO UPDATE SET symptoms = excluded.symptoms, note = excluded.note, updated_at = excluded.updated_at`
        ).bind(dogId, body.day, symptoms, body.note?.slice(0, 500) ?? null, now, now),
      ]);
      return json({ ok: true });
    }
  }

  return json({ ok: false, error: "not found" }, 404);
}

async function ownDog(env: Env, userId: number, dogId: number): Promise<boolean> {
  const r = await env.DB.prepare("SELECT 1 AS x FROM dogs WHERE id = ? AND owner_id = ? AND archived = 0").bind(dogId, userId).first();
  return !!r;
}

// сводка цикла собаки для UI и крона: течки + чекины текущей/последней течки → computeCycleStatus.
// Кэш в KV: ключ cycle:<dog_id>:<version>. Версия лежит в строке собаки (dogs.cycle_version) и
// меняется ТОЛЬКО через bumpCycleVersion() тем же db.batch, что и мутация, — атомарно с данными.
// Читатель с более новой версией, чем KV, идёт в D1 и пишет запись; старые версии просто
// протухают (TTL 3 дня). Рассинхрон невозможен: ключ содержит версию.
export async function cycleStatus(env: Env, dogId: number): Promise<ReturnType<typeof computeCycleStatus>> {
  const dog = await env.DB.prepare(
    "SELECT birth_date, breed, weight_grams, cycle_version FROM dogs WHERE id = ?"
  ).bind(dogId).first<{ birth_date: string | null; breed: string | null; weight_grams: number | null; cycle_version: number | null }>();
  const version = dog?.cycle_version ?? 0;
  const cacheKey = `cycle:${dogId}:${version}`;
  if (version > 0) {
    try {
      const cached = await env.KV.get(cacheKey);
      if (cached) return JSON.parse(cached) as ReturnType<typeof computeCycleStatus>;
    } catch { /* KV недоступен — прозрачно идём в D1, кэш не критичен */ }
  }
  // нулевой версии кэш не пишем: собака ещё ни разу не мутировала с 0004 (версия 0 у
  // всех существующих), первая мутация поднимет версию и включит кэш; до этого — D1
  const heats = (await env.DB.prepare(
    "SELECT started_on, ended_on, note FROM heats WHERE dog_id = ? ORDER BY started_on"
  ).bind(dogId).all<{ started_on: string; ended_on: string | null; note: string | null }>()).results;
  const last = heats.length ? heats[heats.length - 1] : null;
  const from = last ? last.started_on : "0000-01-01";
  const checkins = (await env.DB.prepare(
    "SELECT day, symptoms FROM daily_checkins WHERE dog_id = ? AND day >= ? ORDER BY day"
  ).bind(dogId, from).all<{ day: string; symptoms: string }>()).results
    .map(r => ({ day: r.day, symptoms: JSON.parse(r.symptoms) as string[] }));
  const status = computeCycleStatus({
    today: dayMsk(),
    heats,
    checkins,
    birthDate: dog?.birth_date ?? null,
    breedProfile: resolveBreedProfile(dog?.breed, dog?.weight_grams),
  });
  if (version > 0) {
    try { await env.KV.put(cacheKey, JSON.stringify(status), { expirationTtl: 3 * 86400 }); } catch { /* запись в кэш не критична */ }
  }
  return status;
}

// инвалидация кэша цикла: версию собаки поднимаем той же batch-операцией, что и мутация
// (если падает batch — не меняется ни данные, ни версия; если проходит — ключи старой
// версии больше никогда не читаются). Вызывать env.DB.batch([...bumpCycleVersion(env, dogId), stmt]).
export function bumpCycleVersion(env: Env, dogId: number) {
  return env.DB.prepare("UPDATE dogs SET cycle_version = cycle_version + 1 WHERE id = ?").bind(dogId);
}

// настройки уведомлений: {} по умолчанию (opt-in)
export function parseNotify(r: Row | null): Record<string, unknown> {
  if (!r?.notify_settings) return {};
  try { return JSON.parse(r.notify_settings) as Record<string, unknown>; } catch { return {}; }
}

async function touchUser(env: Env, user: TgUser): Promise<void> {
  // один запрос вместо SELECT+UPDATE на каждый вызов API: upsert, который
  // двигает last_seen_at только если прошло > часа (иначе запись бессмысленна
  // и ест дневной лимит write). Username подтягивается всегда.
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO users (id, username, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen_at = CASE WHEN users.last_seen_at < ? THEN excluded.last_seen_at ELSE users.last_seen_at END,
       username = excluded.username`
  ).bind(user.id, user.username ?? null, now, now, now).run();
}
