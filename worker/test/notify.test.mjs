// Тесты логики уведомлений (чистая часть). node --test worker/test/notify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideNotifications, dayMsk } from "../src/notify.ts";
import { computeCycleStatus } from "../src/cycle.ts";

const T = "2026-11-03";
const st = (heats, checkins = [], today = T, birthDate = null) =>
  computeCycleStatus({ today, heats, checkins, birthDate });

test("всё выключено — пусто", () => {
  const s = st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }]);
  assert.deepEqual(decideNotifications(s, {}, true), []);
  assert.deepEqual(decideNotifications(s, { enabled: false }, true), []);
});

test("advance: ровно advance_days до окна", () => {
  // одна закрытая течка 2026-06-10 → норма 180: expectedOn 2026-12-07 ±14 → окно от 2026-11-23
  const s = st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], [], "2026-11-09");
  const out = decideNotifications(s, { enabled: true, advance_days: 14 }, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "advance");
  assert.match(out[0].text, /через 14 дн/);
  // advance_days не совпал — тишина
  const out2 = decideNotifications(s, { enabled: true, advance_days: 3 }, true);
  assert.deepEqual(out2, []);
});

test("day_of_heat: сегодня расчётная дата начала", () => {
  // одна течка → норма 180: 2026-06-10 + 180 = 2026-12-07. Сегодня = 2026-12-07
  const s = st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], [], "2026-12-07");
  const out = decideNotifications(s, { day_of_heat: true }, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "day_of_heat");
});

test("в течке: напоминание о чекине, только если чекина нет", () => {
  const s = st([{ started_on: "2026-10-30", ended_on: null }], [], T);
  const noChk = decideNotifications(s, { checkin_reminder: true }, false);
  assert.equal(noChk.length, 1);
  assert.equal(noChk[0].kind, "checkin_reminder");
  assert.match(noChk[0].text, /5-й день/);
  assert.deepEqual(decideNotifications(s, { checkin_reminder: true }, true), []);
});

test("overdue: напоминает на 1-й, 8-й, 15-й день просрочки", () => {
  // одна течка 2026-06-10 → окно 2026-11-23..2026-12-21
  const mk = (today) => st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], [], today);
  assert.equal(decideNotifications(mk("2026-12-22"), { enabled: true }, true).filter(n => n.kind === "overdue").length, 1);
  assert.equal(decideNotifications(mk("2026-12-25"), { enabled: true }, true).filter(n => n.kind === "overdue").length, 0);
  assert.equal(decideNotifications(mk("2026-12-29"), { enabled: true }, true).filter(n => n.kind === "overdue").length, 1);
});

test("текст advance содержит окно дат", () => {
  const s = st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], [], "2026-11-09");
  const out = decideNotifications(s, { enabled: true, advance_days: 14 }, true);
  assert.ok(out[0].text.includes("окно"));
});

// --- wave 4 ---

test("pus_discharge: уведомление идёт даже при выключенных тумблерах (но не при enabled=false)", () => {
  const s = st(
    [{ started_on: "2026-06-10", ended_on: "2026-07-01" }],
    [{ day: "2026-11-01", symptoms: ["discharge_pus"] }],
  );
  const out = decideNotifications(s, {}, true);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "pus_discharge");
  assert.match(out[0].text, /ветеринару/);

  const off = decideNotifications(s, { enabled: false }, true);
  assert.deepEqual(off, []);
  // без симптома — тишина
  const noPus = decideNotifications(st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], []), {}, true);
  assert.deepEqual(noPus, []);
});

test("postheat_watch: карточка про ложную щенность внутри окна 30–60 дн", () => {
  const s = st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], [], "2026-08-15");
  const out = decideNotifications(s, { enabled: true }, true);
  assert.equal(out.filter(n => n.kind === "postheat_watch").length, 1);
  assert.match(out[0].text, /ложная щенность|щенность/);

  // вне окна — нет
  const s2 = st([{ started_on: "2026-06-10", ended_on: "2026-07-01" }], [], T);
  assert.equal(decideNotifications(s2, { enabled: true }, true).filter(n => n.kind === "postheat_watch").length, 0);
});

test("close_nudge: раз в 3 дня после ожидаемого окончания, не каждый день", () => {
  // открытая с 2026-10-01, avgDuration нет → ожидаемое окончание +21 → 2026-10-21
  const mk = (today) => st([{ started_on: "2026-10-01", ended_on: null }], [], today);
  const n = (today) => decideNotifications(mk(today), { enabled: true }, true)
    .filter(x => x.kind === "close_nudge").length;
  // просрочка 1 дн (22.10), 4 дн (25.10), 7 дн (28.10) — шлём
  assert.equal(n("2026-10-22"), 1);
  assert.equal(n("2026-10-25"), 1);
  assert.equal(n("2026-10-28"), 1);
  // 2, 3, 5, 6 дн просрочки — тишина
  assert.equal(n("2026-10-23"), 0);
  assert.equal(n("2026-10-24"), 0);
  assert.equal(n("2026-10-26"), 0);
  assert.equal(n("2026-10-27"), 0);

  // раньше ожидаемого окончания — нет
  const early = st([{ started_on: "2026-10-01", ended_on: null }], [], "2026-10-15");
  assert.equal(decideNotifications(early, { enabled: true }, true).filter(x => x.kind === "close_nudge").length, 0);
});

test("день MSK: dayMsk сдвигает UTC+3", () => {
  // 2026-11-03 23:00 UTC → в Москве уже 04.11
  assert.equal(dayMsk(new Date("2026-11-03T23:00:00Z")), "2026-11-04");
  assert.equal(dayMsk(new Date("2026-11-03T05:00:00Z")), "2026-11-03");
});
