// Тесты поддержки: чистые функции формата + submit/deliver на фейковых D1 (node:sqlite) и fetch.
// Прогон: node --test worker/test/support.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "fs";
import {
  fingerprintOf, fmtTs, formatWho, formatReportCard, formatUserFollowup, formatUserReply,
  formatReportLine, reportsPageInfo, reportsPageText, reportKeyboard,
  submitManualReport, submitErrorReport, deliverReply, forwardUserFollowup,
  findReportByOwnerMsg, findRepliedReportFor, getFlag, setFlag, OWNER_ID,
} from "../src/support.ts";

// ---- фейковое окружение ----
function makeEnv() {
  const db = new DatabaseSync(":memory:");
  for (const f of ["0001_init.sql", "0005_reports.sql"]) {
    db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
  }
  const D1 = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => db.prepare(sql).all(...args)[0] ?? null,
            all: async () => ({ results: db.prepare(sql).all(...args) }),
            run: async () => { const info = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } }; },
          };
        },
        first: async () => db.prepare(sql).all()[0] ?? null,
        all: async () => ({ results: db.prepare(sql).all() }),
        run: async () => { const info = db.prepare(sql).run(); return { meta: { last_row_id: Number(info.lastInsertRowid), changes: Number(info.changes) } }; },
      };
    },
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  };
  // фейковый Telegram: все sendMessage пишутся в sent
  const sent = [];
  let nextMsgId = 1000;
  let failNext = null; // {error_code, description} — сымитировать 403 и т.п.
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    sent.push({ url: String(url), ...body });
    if (failNext) { const f = failNext; failNext = null; return { json: async () => ({ ok: false, ...f }) }; }
    return { json: async () => ({ ok: true, result: { message_id: nextMsgId++ } }) };
  };
  return { env: { DB: D1, KV: null, BOT_TOKEN: "tok", WEBHOOK_SECRET: "s" }, sent, db, failWith: (f) => { failNext = f; } };
}

// ---- чистые функции ----
test("fingerprintOf стабилен и различает текст/экран", () => {
  const a = fingerprintOf("error", "TypeError: x", "p1");
  assert.equal(a, fingerprintOf("error", "TypeError: x", "p1"));
  assert.notEqual(a, fingerprintOf("error", "TypeError: y", "p1"));
  assert.notEqual(a, fingerprintOf("error", "TypeError: x", "p2"));
  assert.match(a, /^[0-9a-f]{8}$/);
});

test("fmtTs — МСК из ISO", () => {
  assert.equal(fmtTs("2026-11-08T11:32:00.000Z"), "08.11 14:32");
  assert.equal(fmtTs("2026-01-01T21:05:00.000Z"), "02.01 00:05");
});

test("formatWho: с username и без", () => {
  assert.equal(formatWho({ username: "nastia", tg_user_id: 5 }), "@nastia (5)");
  assert.equal(formatWho({ username: null, tg_user_id: 5 }), "(5)");
});

test("formatReportCard: manual — жалоба с контекстом и статусом", () => {
  const card = formatReportCard({
    id: 4, tg_user_id: 5, username: "nastia", dog_name: "Лонда", kind: "manual",
    text: "всё сломалось", page: "p1", bundle_ver: "abc", fingerprint: null,
    seen_count: 1, status: "new", owner_msg_id: null, last_notify_at: null,
    created_at: "2026-11-08T11:32:00.000Z", updated_at: "2026-11-08T11:32:00.000Z",
  });
  assert.match(card, /📮 Жалоба #4 — 08\.11 14:32/);
  assert.match(card, /@nastia \(5\) · «Лонда»/);
  assert.match(card, /Экран: p1 · бандл abc/);
  assert.match(card, /«всё сломалось»/);
  assert.match(card, /Статус: новая/);
});

test("formatReportCard: error — счётчик повторов и первый увидевший", () => {
  const card = formatReportCard({
    id: 9, tg_user_id: 7, username: null, dog_name: null, kind: "error",
    text: "s is not defined\n  at renderToday (index.html:900)", page: "p1", bundle_ver: "b48",
    fingerprint: "deadbeef", seen_count: 3, status: "new", owner_msg_id: null, last_notify_at: null,
    created_at: "2026-11-08T11:32:00.000Z", updated_at: "2026-11-08T11:32:00.000Z",
  });
  assert.match(card, /🐛 Ошибка клиента #9 — ×3/);
  assert.match(card, /s is not defined/);
  assert.match(card, /renderToday/); // стек присутствует
  assert.match(card, /Первый раз: 08\.11 14:32 · \(7\)/);
  assert.ok(!card.includes("Жалоба"));
});

test("formatUserFollowup и formatUserReply", () => {
  assert.equal(
    formatUserFollowup({ id: 4, username: "nastia", tg_user_id: 5 }, "спасибо!"),
    "↩️ Ответ на жалобу #4 — @nastia (5):\n«спасибо!»"
  );
  assert.equal(formatUserReply("Починили"), "Ответ разработчика Cavalla:\n\nПочинили");
});

test("reportsPageInfo зажимает страницу; reportsPageText для пустоты", () => {
  assert.deepEqual(reportsPageInfo(12, 99), { page: 2, pages: 3, offset: 10 });
  assert.deepEqual(reportsPageInfo(0, 0), { page: 0, pages: 1, offset: 0 });
  assert.equal(reportsPageText([], 0, 1, 0), "Открытых жалоб нет.");
});

test("formatReportLine: manual и error различаются", () => {
  const base = {
    id: 4, tg_user_id: 5, username: "n", dog_name: null, page: null, bundle_ver: null,
    fingerprint: null, seen_count: 1, status: "new", owner_msg_id: null, last_notify_at: null,
    created_at: "2026-11-08T11:32:00.000Z", updated_at: "2026-11-08T11:32:00.000Z",
  };
  assert.match(formatReportLine({ ...base, kind: "manual", text: "проблема" }), /📮 #4 @n \(5\)/);
  assert.match(formatReportLine({ ...base, kind: "error", text: "err", seen_count: 7 }), /🐛 #4 ×7/);
});

test("reportKeyboard: manual — две кнопки, error — одна", () => {
  assert.equal(reportKeyboard({ id: 1, kind: "manual" }).inline_keyboard[0].length, 2);
  assert.equal(reportKeyboard({ id: 1, kind: "error" }).inline_keyboard[0].length, 1);
  assert.equal(reportKeyboard({ id: 1, kind: "manual" }).inline_keyboard[0][0].callback_data, "rep:reply:1");
});

// ---- интеграция ----
test("submitManualReport: запись в D1 + уведомление владельцу с клавиатурой", async () => {
  const { env, sent } = makeEnv();
  const r = await submitManualReport(env, { id: 5, username: "nastia" },
    { text: "не закрывается течка", page: "p1", bundle_ver: "v1", dog_id: null });
  assert.deepEqual(r, { ok: true });
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /sendMessage/);
  assert.equal(sent[0].chat_id, OWNER_ID);
  assert.match(sent[0].text, /Жалоба #1/);
  assert.equal(sent[0].reply_markup.inline_keyboard[0].length, 2);
});

test("submitManualReport: пустой текст → 400, rate limit 5/час → 429", async () => {
  const { env } = makeEnv();
  const bad = await submitManualReport(env, { id: 5 }, { text: "   " });
  assert.deepEqual(bad, { ok: false, error: "text required", status: 400 });
  for (let i = 0; i < 5; i++) {
    await submitManualReport(env, { id: 5 }, { text: `жалоба ${i}` });
  }
  const sixth = await submitManualReport(env, { id: 5 }, { text: "шестая" });
  assert.deepEqual(sixth, { ok: false, error: "too many reports", status: 429 });
});

test("submitManualReport: dog_name подтягивается и денормализуется", async () => {
  const { env } = makeEnv();
  env.DB.prepare("INSERT INTO users (id, first_seen_at, last_seen_at) VALUES (5, 'x', 'x')").run();
  env.DB.prepare("INSERT INTO dogs (id, owner_id, name, created_at) VALUES (13, 5, 'Лонда', 'x')").run();
  await submitManualReport(env, { id: 5, username: "n" }, { text: "проблема", dog_id: 13 });
  const d = await env.DB.prepare("SELECT dog_name FROM reports WHERE id = 1").first();
  assert.equal(d.dog_name, "Лонда");
});

test("submitErrorReport: дедуп по fingerprint — одна строка, seen_count растёт, уведомление один раз", async () => {
  const { env, sent } = makeEnv();
  await submitErrorReport(env, "error", { id: 7 }, "s is not defined", "p1", "v1");
  await submitErrorReport(env, "error", { id: 8 }, "s is not defined", "p1", "v1");
  await submitErrorReport(env, "error", { id: 9 }, "s is not defined", "p1", "v1");
  const { results } = await env.DB.prepare("SELECT id, seen_count FROM reports").all();
  assert.equal(results.length, 1);
  assert.equal(results[0].seen_count, 3);
  assert.equal(sent.length, 1); // уведомление только о первом
});

test("submitErrorReport: повтор через сутки → второе уведомление «×N»", async () => {
  const { env, sent } = makeEnv();
  await submitErrorReport(env, "error", { id: 7 }, "boom", "p1", "v1");
  // искусственно состарить last_notify_at
  env.DB.prepare("UPDATE reports SET last_notify_at = '2026-11-01T00:00:00.000Z' WHERE id = 1").run();
  await submitErrorReport(env, "error", { id: 8 }, "boom", "p1", "v1");
  assert.equal(sent.length, 2);
  assert.match(sent[1].text, /♻️ Повтор/);
  assert.match(sent[1].text, /×2/);
});

test("submitErrorReport: закрытая владельцем ошибка при повторе reopening'уется", async () => {
  const { env } = makeEnv();
  await submitErrorReport(env, "error", { id: 7 }, "boom2", "p1", "v1");
  env.DB.prepare("UPDATE reports SET status = 'resolved', last_notify_at = '2026-11-01T00:00:00.000Z' WHERE id = 1").run();
  await submitErrorReport(env, "error", { id: 8 }, "boom2", "p1", "v1");
  const r = await env.DB.prepare("SELECT status FROM reports WHERE id = 1").first();
  assert.equal(r.status, "new");
});

test("deliverReply: успех → статус replied + сообщение пользователю; 403 → статус не меняется", async () => {
  const { env, sent, failWith } = makeEnv();
  await submitManualReport(env, { id: 5, username: "n" }, { text: "вопрос" });
  const rep = await env.DB.prepare("SELECT * FROM reports WHERE id = 1").first();
  assert.equal(rep.status, "new");

  const err = await deliverReply(env, rep, "Починили");
  assert.equal(err, null);
  assert.equal(sent[sent.length - 1].chat_id, 5);
  assert.match(sent[sent.length - 1].text, /Ответ разработчика Cavalla:\n\nПочинили/);
  const after = await env.DB.prepare("SELECT status FROM reports WHERE id = 1").first();
  assert.equal(after.status, "replied");

  // 403: статус остаётся replied (не resolved), возвращается причина
  failWith({ error_code: 403, description: "bot was blocked" });
  const err2 = await deliverReply(env, rep, "ещё");
  assert.match(err2, /заблокировал бота/);
});

test("findReportByOwnerMsg: поиск по сохранённому message_id уведомления", async () => {
  const { env } = makeEnv();
  await submitManualReport(env, { id: 5, username: "n" }, { text: "вопрос" });
  const r = await findReportByOwnerMsg(env, 1000); // первый message_id фейкового TG
  assert.equal(r?.id, 1);
  assert.equal(await findReportByOwnerMsg(env, 999999), null);
});

test("findRepliedReportFor: только replied и только в окне 72 ч", async () => {
  const { env } = makeEnv();
  await submitManualReport(env, { id: 5 }, { text: "вопрос" });
  assert.equal(await findRepliedReportFor(env, 5), null); // status=new
  const rep = await env.DB.prepare("SELECT * FROM reports WHERE id = 1").first();
  await deliverReply(env, rep, "ответ");
  assert.equal((await findRepliedReportFor(env, 5))?.id, 1);
  // состарить за окно
  env.DB.prepare("UPDATE reports SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = 1").run();
  assert.equal(await findRepliedReportFor(env, 5), null);
});

test("forwardUserFollowup: уведомление владельцу + статус new + новый owner_msg_id", async () => {
  const { env, sent } = makeEnv();
  await submitManualReport(env, { id: 5, username: "n" }, { text: "вопрос" });
  const rep = await env.DB.prepare("SELECT * FROM reports WHERE id = 1").first();
  await deliverReply(env, rep, "ответ");
  const before = sent.length;
  const replied = await findRepliedReportFor(env, 5);
  await forwardUserFollowup(env, replied, "спасибо, а как закрыть?");
  assert.equal(sent.length, before + 1);
  const last = sent[sent.length - 1];
  assert.equal(last.chat_id, OWNER_ID);
  assert.match(last.text, /↩️ Ответ на жалобу #1 — @n \(5\)/);
  const after = await env.DB.prepare("SELECT status, owner_msg_id FROM reports WHERE id = 1").first();
  assert.equal(after.status, "new");
  assert.ok(after.owner_msg_id > rep.owner_msg_id); // перепривязали тред
});

test("getFlag/setFlag: цикл записи-чтения-удаления", async () => {
  const { env } = makeEnv();
  assert.equal(await getFlag(env, "reply_to:1"), null);
  await setFlag(env, "reply_to:1", "4|123");
  assert.equal(await getFlag(env, "reply_to:1"), "4|123");
  await setFlag(env, "reply_to:1", "5|456"); // upsert
  assert.equal(await getFlag(env, "reply_to:1"), "5|456");
  await setFlag(env, "reply_to:1", null);
  assert.equal(await getFlag(env, "reply_to:1"), null);
});
