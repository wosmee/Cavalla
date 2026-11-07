// Поддержка: жалобы пользователей (кнопка-конверт в мини-аппе), авто-репорты ошибок
// (window.onerror / unhandledrejection) и серверные сбои воркера.
// Форматирование — чистые функции (тестируются node --test), интеграция с D1/Telegram —
// submit*/deliver* (env-инъекция, фейковый fetch в тестах).
import type { Env } from "./types";

// Владелец (Илья). Тот же id, что в /polz — перенесён сюда, чтобы api/bot импортировали.
export const OWNER_ID = 673947355;

export type ReportKind = "manual" | "error" | "server";

export interface ReportRow {
  id: number;
  tg_user_id: number;
  username: string | null;
  dog_name: string | null;
  kind: ReportKind;
  text: string;
  page: string | null;
  bundle_ver: string | null;
  fingerprint: string | null;
  seen_count: number;
  status: "new" | "replied" | "resolved";
  owner_msg_id: number | null;
  last_notify_at: string | null;
  created_at: string;
  updated_at: string;
}

// ---- чистые функции формата ----

// FNV-1a: стабильный короткий fingerprint ошибки (детерминирован между перезапусками,
// в отличие от hashCode-случайных схем; collisions на нашем объёме не проблема).
export function fingerprintOf(kind: string, text: string, page: string | null): string {
  const s = `${kind}|${text.slice(0, 200)}|${page ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// «08.11 14:32» в МСК из ISO-строки
export function fmtTs(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function formatWho(r: Pick<ReportRow, "username" | "tg_user_id">): string {
  return r.username ? `@${r.username} (${r.tg_user_id})` : `(${r.tg_user_id})`;
}

const STATUS_RU: Record<ReportRow["status"], string> = { new: "новая", replied: "отвечено", resolved: "закрыта" };

// Карточка жалобы/ошибки — она же текст уведомления владельцу и текст «Открыть #N».
export function formatReportCard(r: ReportRow): string {
  const ctx = [r.page ? `Экран: ${r.page}` : null, r.bundle_ver ? `бандл ${r.bundle_ver}` : null]
    .filter(Boolean).join(" · ");
  if (r.kind === "manual") {
    const lines = [
      `📮 Жалоба #${r.id} — ${fmtTs(r.created_at)}`,
      `От: ${formatWho(r)}${r.dog_name ? ` · «${r.dog_name}»` : ""}`,
    ];
    if (ctx) lines.push(ctx);
    lines.push("", `«${r.text}»`, "", `Статус: ${STATUS_RU[r.status]}`);
    return lines.join("\n");
  }
  // error / server: техническая карточка без «От» в заголовке — это не жалоба
  const firstLine = r.text.split("\n")[0].slice(0, 160);
  const lines = [
    `🐛 ${r.kind === "server" ? "Сбой воркера" : "Ошибка клиента"} #${r.id} — ×${r.seen_count}`,
    firstLine,
  ];
  if (ctx) lines.push(ctx);
  lines.push(`Первый раз: ${fmtTs(r.created_at)} · ${formatWho(r)}`);
  if (r.text.includes("\n")) lines.push("", r.text.slice(0, 1200));
  lines.push("", `Статус: ${STATUS_RU[r.status]}`);
  return lines.join("\n");
}

// сообщение владельцу: пользователь ответил в треде
export function formatUserFollowup(r: ReportRow, userText: string): string {
  return `↩️ Ответ на жалобу #${r.id} — ${formatWho(r)}:\n«${userText}»`;
}

// сообщение пользователю: ответ разработчика
export function formatUserReply(text: string): string {
  return `Ответ разработчика Cavalla:\n\n${text}`;
}

// очередь /reports — страница коротких строк
export const REPORTS_PAGE_SIZE = 5;

export function formatReportLine(r: ReportRow): string {
  const mark = r.kind === "manual" ? "📮" : "🐛";
  const who = r.kind === "manual" ? formatWho(r) : `×${r.seen_count}`;
  const first = r.text.split("\n")[0].slice(0, 70);
  return `${mark} #${r.id} ${who} · ${fmtTs(r.created_at)}\n   «${first}»`;
}

export function reportsPageText(lines: string[], page: number, pages: number, total: number): string {
  if (total === 0) return "Открытых жалоб нет.";
  return `Открытые жалобы — стр. ${page + 1}/${pages} (всего ${total})\n\n${lines.join("\n\n")}`;
}

export function reportsPageInfo(total: number, page: number): { page: number; pages: number; offset: number } {
  const pages = Math.max(1, Math.ceil(total / REPORTS_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { page: p, pages, offset: p * REPORTS_PAGE_SIZE };
}

// клавиатура карточки: manual — ответить/решено, error/server — только закрыть.
// Тип структурный (совместим с InlineKeyboardMarkup grammY)
export interface InlineKb { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
export function reportKeyboard(r: Pick<ReportRow, "id" | "kind">): InlineKb {
  return r.kind === "manual"
    ? { inline_keyboard: [[
        { text: "💬 Ответить", callback_data: `rep:reply:${r.id}` },
        { text: "✓ Решено", callback_data: `rep:done:${r.id}` },
      ]] }
    : { inline_keyboard: [[{ text: "✓ Закрыть", callback_data: `rep:done:${r.id}` }]] };
}

// ---- интеграция: Telegram ----

export async function sendTelegram(
  env: Env, chatId: number, text: string, replyMarkup?: object
): Promise<{ ok: boolean; message_id?: number; error_code?: number; description?: string }> {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
  }).then(x => x.json() as Promise<any>);
  return r.ok ? { ok: true, message_id: r.result?.message_id } : { ok: false, error_code: r.error_code, description: r.description };
}

// уведомить владельца о новой/повторной карточке; message_id сохраняем в отчёт —
// по нему работает reply-тред («ответить на это сообщение»)
async function notifyOwner(env: Env, id: number, text: string, keyboard: object): Promise<void> {
  try {
    const r = await sendTelegram(env, OWNER_ID, text, keyboard);
    const now = new Date().toISOString();
    if (r.ok) {
      await env.DB.prepare("UPDATE reports SET owner_msg_id = ?, last_notify_at = ?, updated_at = ? WHERE id = ?")
        .bind(r.message_id ?? null, now, now, id).run();
    } else {
      await env.DB.prepare("UPDATE reports SET last_notify_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, id).run();
    }
  } catch (e) {
    console.error("support: notify owner failed", String(e));
  }
}

// ---- интеграция: приём репортов ----

export interface SubmitManualInput {
  text: string;
  page?: string | null;
  bundle_ver?: string | null;
  dog_id?: number | null;
}

// POST /api/reports kind=manual. Возвращает {ok:true} либо {error,status}.
export async function submitManualReport(
  env: Env, user: { id: number; username?: string }, input: SubmitManualInput
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const text = String(input.text ?? "").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "text required", status: 400 };
  // rate limit: 5 ручных жалоб в час на юзера (COUNT в D1 — их мало, KV не нужен)
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reports WHERE tg_user_id = ? AND kind = 'manual' AND created_at >= ?"
  ).bind(user.id, hourAgo).first<{ n: number }>();
  if (Number(cnt?.n ?? 0) >= 5) return { ok: false, error: "too many reports", status: 429 };

  let dogName: string | null = null;
  if (input.dog_id) {
    const d = await env.DB.prepare("SELECT name FROM dogs WHERE id = ? AND owner_id = ?")
      .bind(input.dog_id, user.id).first<{ name: string }>();
    dogName = d?.name ?? null;
  }
  const now = new Date().toISOString();
  const ins = await env.DB.prepare(
    `INSERT INTO reports (tg_user_id, username, dog_name, kind, text, page, bundle_ver, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?)`
  ).bind(user.id, user.username ?? null, dogName, text,
         input.page?.slice(0, 50) ?? null, input.bundle_ver?.slice(0, 30) ?? null, now, now).run();
  const id = Number(ins.meta?.last_row_id ?? 0);
  const row = await loadReport(env, id);
  if (row) await notifyOwner(env, id, formatReportCard(row), reportKeyboard(row));
  return { ok: true };
}

// авто-репорты (error/server): дедуп по fingerprint — повтор внутри суток только
// инкрементит seen_count; раз в сутки шлём «×N». Закрытая владельцем ошибка при
// новых попаданиях reopening'уется (тоже раз в сутки) — значит, не починилась.
export async function submitErrorReport(
  env: Env, kind: "error" | "server", user: { id: number; username?: string },
  text: string, page?: string | null, bundleVer?: string | null
): Promise<{ ok: true; deduped?: boolean }> {
  const clean = String(text ?? "").trim().slice(0, 3000);
  if (!clean) return { ok: true, deduped: true };
  const fp = fingerprintOf(kind, clean, page ?? null);
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const existing = await env.DB.prepare("SELECT * FROM reports WHERE fingerprint = ?").bind(fp).first<ReportRow>();
  if (existing) {
    await env.DB.prepare("UPDATE reports SET seen_count = seen_count + 1, updated_at = ? WHERE id = ?")
      .bind(now, existing.id).run();
    const stale = !existing.last_notify_at || existing.last_notify_at < dayAgo;
    if (stale) {
      const fresh: ReportRow = { ...existing, seen_count: existing.seen_count + 1 };
      if (existing.status === "resolved") {
        await env.DB.prepare("UPDATE reports SET status = 'new', updated_at = ? WHERE id = ?").bind(now, existing.id).run();
        fresh.status = "new";
      }
      await notifyOwner(env, existing.id, `♻️ Повтор:\n${formatReportCard(fresh)}`, reportKeyboard(fresh));
    }
    return { ok: true, deduped: true };
  }
  const ins = await env.DB.prepare(
    `INSERT INTO reports (tg_user_id, username, kind, text, page, bundle_ver, fingerprint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, user.username ?? null, kind, clean, page?.slice(0, 50) ?? null,
         bundleVer?.slice(0, 30) ?? null, fp, now, now).run();
  const id = Number(ins.meta?.last_row_id ?? 0);
  const row = await loadReport(env, id);
  if (row) await notifyOwner(env, id, formatReportCard(row), reportKeyboard(row));
  return { ok: true };
}

// серверный сбой из catch-all: fire-and-forget, никогда не роняет основной ответ
export function recordServerError(env: Env, where: string, err: unknown): void {
  const text = `${where}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`.slice(0, 3000);
  submitErrorReport(env, "server", { id: 0 }, text).catch(e => console.error("support: recordServerError", String(e)));
}

export async function loadReport(env: Env, id: number): Promise<ReportRow | null> {
  return env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(id).first<ReportRow>();
}

// поиск отчёта по message_id уведомления владельцу (reply-тред)
export async function findReportByOwnerMsg(env: Env, messageId: number): Promise<ReportRow | null> {
  return env.DB.prepare("SELECT * FROM reports WHERE owner_msg_id = ?").bind(messageId).first<ReportRow>();
}

// ---- интеграция: флаги режима «Ответить» (D1, не KV — read-after-write мгновенный) ----

export async function getFlag(env: Env, name: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM support_flags WHERE name = ?").bind(name).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setFlag(env: Env, name: string, value: string | null): Promise<void> {
  const now = new Date().toISOString();
  if (value === null) {
    await env.DB.prepare("DELETE FROM support_flags WHERE name = ?").bind(name).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO support_flags (name, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(name, value, now).run();
  }
}

// ---- интеграция: доставка ответа пользователю ----

// ответ владельца → личка пользователя. Возвращает причину недоставки (403 и т.п.) или null.
export async function deliverReply(env: Env, report: ReportRow, text: string): Promise<string | null> {
  const r = await sendTelegram(env, report.tg_user_id, formatUserReply(text));
  if (!r.ok) {
    if (r.error_code === 403) return "пользователь заблокировал бота — доставка невозможна";
    return r.description ?? `error ${r.error_code ?? "?"}`;
  }
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE reports SET status = 'replied', updated_at = ? WHERE id = ?")
    .bind(now, report.id).run();
  return null;
}

// ответ пользователя в треде → уведомление владельцу; жалоба снова «новая» (видна в /reports)
export async function forwardUserFollowup(env: Env, report: ReportRow, userText: string): Promise<void> {
  const text = formatUserFollowup(report, userText.slice(0, 2000));
  const r = await sendTelegram(env, OWNER_ID, text, reportKeyboard({ id: report.id, kind: "manual" }));
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE reports SET status = 'new', owner_msg_id = ?, updated_at = ? WHERE id = ?"
  ).bind(r.ok ? (r.message_id ?? null) : report.owner_msg_id, now, report.id).run();
}

// последняя отвеченная жалоба пользователя в окне 72 ч (тред для followup):
// без окна любой текст боту считался бы ответом на старую жалобу
export async function findRepliedReportFor(env: Env, userId: number): Promise<ReportRow | null> {
  const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
  return env.DB.prepare(
    "SELECT * FROM reports WHERE tg_user_id = ? AND kind = 'manual' AND status = 'replied' AND updated_at >= ? ORDER BY updated_at DESC LIMIT 1"
  ).bind(userId, cutoff).first<ReportRow>();
}
