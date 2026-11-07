// Тесты прогноз-движка (чистая логика, Node). Прогон: node --test worker/test/cycle.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCycleStatus } from "../src/cycle.ts";

const T = "2026-11-03";
const h = (s, e = null) => ({ started_on: s, ended_on: e });

test("пустая история: прогноза нет, без паники", () => {
  const st = computeCycleStatus({ today: T, heats: [] });
  assert.equal(st.inHeat, false);
  assert.equal(st.nextHeat, null);
  assert.equal(st.stats.heatsCount, 0);
  assert.deepEqual(st.alerts, []);
});

test("одна закрытая течка: прогноз по глобальной норме ±14, hint=true", () => {
  const st = computeCycleStatus({ today: T, heats: [h("2026-06-10", "2026-07-01")] });
  assert.equal(st.nextHeat.expectedOn, "2026-12-07"); // 2026-06-10 + 180
  assert.equal(st.nextHeat.marginDays, 14);
  assert.equal(st.nextHeat.confidence, "low");
  assert.equal(st.nextHeat.hint, true);
  assert.equal(st.stats.medianIntervalDays, null);
  assert.equal(st.stats.avgDurationDays, 22);
  // окно ещё впереди: 2026-11-23
  assert.equal(st.daysToNext, 20);
});

test("один интервал: медиана есть, спреда нет, margin широкий без hint", () => {
  const st = computeCycleStatus({ today: T, heats: [h("2026-01-01", "2026-01-20"), h("2026-06-10", "2026-07-01")] });
  // единственный интервал 160
  assert.equal(st.stats.medianIntervalDays, 160);
  assert.equal(st.stats.spreadDays, null);
  assert.equal(st.stats.regularity, null);
  assert.equal(st.nextHeat.marginDays, 14); // один интервал — широкий
  assert.equal(st.nextHeat.confidence, "low");
  assert.equal(st.nextHeat.hint, false); // hint только при нуле интервалов
  assert.equal(st.nextHeat.expectedOn, "2026-11-17"); // 2026-06-10 + 160
  // expectedOn-14 = 2026-11-03 = сегодня → окно уже открылось
  assert.equal(st.daysToNext, 0);
});

test("три интервала: медиана, спред, very-stable, margin=min(30,max(7,spread))", () => {
  // 2025-05-01 → 2025-10-30 (182) → 2026-04-30 (182) → 2026-10-29 (182)
  const heats = [
    h("2025-05-01", "2025-05-22"),
    h("2025-10-30", "2025-11-20"),
    h("2026-04-30", "2026-05-21"),
    h("2026-10-29"), // открытая
  ];
  const st = computeCycleStatus({ today: T, heats });
  assert.equal(st.stats.medianIntervalDays, 182);
  assert.equal(st.stats.spreadDays, 0);
  assert.equal(st.stats.regularity, "very-stable");
  assert.equal(st.inHeat, true);
  // открытая течка началась 2026-10-29 → день 6
  assert.equal(st.openHeat.day, 6);
  assert.equal(st.openHeat.phase, "proestrus");
  assert.equal(st.openHeat.phaseSource, "days");
  assert.equal(st.openHeat.estrusWindow.from, "2026-11-06");
  assert.equal(st.openHeat.estrusWindow.to, "2026-11-12");
  // прогноз следующей — от начала открытой + 182
  assert.equal(st.nextHeat.expectedOn, "2027-04-29");
  assert.equal(st.nextHeat.marginDays, 7);
  assert.equal(st.nextHeat.confidence, "high");
  assert.equal(st.stats.avgDurationDays, 22);
});

test("симптомы двигают фазу вперёд счёта дней", () => {
  const heats = [h("2026-10-30")]; // день 5
  const stNoSym = computeCycleStatus({ today: T, heats, checkins: [] });
  assert.equal(stNoSym.openHeat.phase, "proestrus");
  assert.equal(stNoSym.openHeat.phaseSource, "days");

  const stSym = computeCycleStatus({
    today: T, heats,
    checkins: [{ day: "2026-11-01", symptoms: ["discharge_light"] }],
  });
  assert.equal(stSym.openHeat.phase, "estrus");
  assert.equal(stSym.openHeat.phaseSource, "symptoms");
  assert.equal(stSym.openHeat.estrusWindow.from, "2026-11-01");
  assert.equal(stSym.openHeat.estrusWindow.to, "2026-11-09");
});

test("охватной симптом до начала течки не считается", () => {
  const st = computeCycleStatus({
    today: T, heats: [h("2026-10-30")],
    checkins: [{ day: "2026-10-20", symptoms: ["flirty"] }],
  });
  assert.equal(st.openHeat.phaseSource, "days");
});

test("тревога: открытая течка дольше 30 дн (порог по ветсправочникам)", () => {
  // 2026-09-25 → 03.11 = 40-й день
  const st = computeCycleStatus({ today: T, heats: [h("2026-09-25")] });
  assert.equal(st.openHeat.phase, "overdue");
  assert.ok(st.alerts.some(a => a.kind === "heat_long" && a.days === 40));
  // 29 дней (2026-10-06) — ещё норма
  const stOk = computeCycleStatus({ today: T, heats: [h("2026-10-06")] });
  assert.ok(!stOk.alerts.some(a => a.kind === "heat_long"));
  // 30-й день (2026-10-05) — тревога
  const st30 = computeCycleStatus({ today: T, heats: [h("2026-10-05")] });
  assert.ok(st30.alerts.some(a => a.kind === "heat_long" && a.days === 30));
});

test("тревога: нет течки дольше 12 мес при закрытой истории", () => {
  const st = computeCycleStatus({ today: T, heats: [h("2025-06-01", "2025-06-20")] });
  assert.ok(st.alerts.some(a => a.kind === "no_heat_long"));
  assert.ok(st.nextHeat.overdueDays > 0);
});

test("тревога: первая течка позже 18 мес", () => {
  const st = computeCycleStatus({ today: T, birthDate: "2024-10-01", heats: [] });
  assert.ok(st.alerts.some(a => a.kind === "first_heat_late" && a.months === 25));
});

test("тревога: исторический интервал <100 и >365", () => {
  const stShort = computeCycleStatus({
    today: T,
    heats: [h("2026-04-01", "2026-04-20"), h("2026-06-20", "2026-07-10")], // интервал 80
  });
  assert.ok(stShort.alerts.some(a => a.kind === "interval_short" && a.days === 80));

  const stLong = computeCycleStatus({
    today: T,
    heats: [h("2025-01-01", "2025-01-20"), h("2026-03-01", "2026-03-20")], // интервал 424
  });
  assert.ok(stLong.alerts.some(a => a.kind === "interval_long" && a.days === 424));
});

test("интервал короткий — порог от породы: овчарке 145 дн не тревога, unknown 90 тревога", async () => {
  const { resolveBreedProfile } = await import("../src/breeds.ts");
  const gsd = resolveBreedProfile("Немецкая овчарка", null); // large
  const heats145 = [h("2026-03-01", "2026-03-20"), h("2026-07-25", "2026-08-10")]; // интервал 146
  const stGsd = computeCycleStatus({ today: T, heats: heats145, breedProfile: gsd });
  // large: intervalShortAlert 100 → 146 не тревога
  assert.ok(!stGsd.alerts.some(a => a.kind === "interval_short"));

  const unknown = resolveBreedProfile(null, null);
  const heats80 = [h("2026-06-01", "2026-06-20"), h("2026-08-20", "2026-09-05")]; // интервал 80
  const stUnknown = computeCycleStatus({ today: T, heats: heats80, breedProfile: unknown });
  assert.ok(stUnknown.alerts.some(a => a.kind === "interval_short" && a.days === 80));
});

test("overdue-окно: daysToNext null когда окно позади", () => {
  const st = computeCycleStatus({
    today: "2027-01-01",
    heats: [h("2026-01-01", "2026-01-21"), h("2026-06-10", "2026-06-30")], // интервал 160
  });
  // expected 2026-11-17 ±14 → окно до 2026-12-01, сегодня за ним
  assert.equal(st.daysToNext, null);
  assert.ok(st.nextHeat.overdueDays > 0);
  assert.ok(st.alerts.some(a => a.kind === "no_heat_long") === false); // 186 дней — ещё не год
});

test("heats приходят неотсортированными — сортируем", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-06-10", "2026-07-01"), h("2026-01-01", "2026-01-20")],
  });
  assert.equal(st.heats[0].started_on, "2026-01-01");
  assert.equal(st.heats[1].intervalToPrev, 160);
});

test("день начала течки = день 1, не 0", () => {
  const st = computeCycleStatus({ today: T, heats: [h(T)] });
  assert.equal(st.openHeat.day, 1);
});

// --- wave 4: пиометра-симптом, окно после течки ---

test("тревога: гнойные выделения в чекине во время течки", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-10-30")],
    checkins: [{ day: "2026-11-02", symptoms: ["discharge_pus", "restless"] }],
  });
  assert.ok(st.alerts.some(a => a.kind === "pus_discharge"));
});

test("тревога: гнойные выделения после закрытой течки", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-06-10", "2026-07-01")],
    checkins: [{ day: "2026-11-01", symptoms: ["discharge_pus"] }],
  });
  assert.ok(st.alerts.some(a => a.kind === "pus_discharge"));
});

test("гнойные выделения ДО последней течки не считаются", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-10-30")],
    checkins: [{ day: "2026-10-01", symptoms: ["discharge_pus"] }],
  });
  assert.ok(!st.alerts.some(a => a.kind === "pus_discharge"));
});

test("закрытая пиометра: 2+ интоксикационных симптома в окне 7–60 дн после течки", () => {
  // ended 2026-07-01 → окно риска 2026-07-08..2026-08-30
  const s = (day, symptoms) => computeCycleStatus({
    today: T,
    heats: [h("2026-06-10", "2026-07-01")],
    checkins: [{ day, symptoms }],
  });
  // жажда + потеря аппетита — тревога (закрытая форма без выделений)
  assert.ok(s("2026-08-01", ["drinking", "appetite_less"]).alerts.some(a => a.kind === "pus_discharge"));
  // жажда + вялость/беспокойство
  assert.ok(s("2026-07-20", ["drinking", "restless"]).alerts.some(a => a.kind === "pus_discharge"));
  // один симптом — не тревога (просто жаркий день или привередничает)
  assert.ok(!s("2026-08-01", ["drinking"]).alerts.some(a => a.kind === "pus_discharge"));
  // вне окна (до 7 дн после окончания) — не тревога
  assert.ok(!s("2026-07-03", ["drinking", "appetite_less"]).alerts.some(a => a.kind === "pus_discharge"));
  // при открытой течке не применяется (там решает discharge_pus)
  const stOpen = computeCycleStatus({
    today: T, heats: [h("2026-10-30")],
    checkins: [{ day: "2026-11-01", symptoms: ["drinking", "appetite_less"] }],
  });
  assert.ok(!stOpen.alerts.some(a => a.kind === "pus_discharge"));
});

test("postHeatWatch: окно 30–60 дн после окончания последней закрытой", () => {
  // ended 2026-07-01 → окно 2026-07-31..2026-08-30
  const st = computeCycleStatus({ today: T, heats: [h("2026-06-10", "2026-07-01")] });
  assert.equal(st.postHeatWatch.since, "2026-07-01");
  assert.equal(st.postHeatWatch.from, "2026-07-31");
  assert.equal(st.postHeatWatch.to, "2026-08-30");
  assert.equal(st.postHeatWatch.inWindow, false); // 03.11 — окно позади

  const stIn = computeCycleStatus({ today: "2026-08-15", heats: [h("2026-06-10", "2026-07-01")] });
  assert.equal(stIn.postHeatWatch.inWindow, true);

  // единственная открытая течка, закрытых нет
  const stOpen = computeCycleStatus({ today: T, heats: [h("2026-10-30")] });
  assert.equal(stOpen.postHeatWatch, null);
});

test("postHeatWatch: от последней закрытой, даже если позже есть открытая", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-03-01", "2026-03-20"), h("2026-10-30")],
  });
  assert.equal(st.postHeatWatch.since, "2026-03-20");
  assert.equal(st.postHeatWatch.inWindow, false);
});

// --- волна «полезность антонимов»: хинт «успокоилась — закрыть течку» ---

test("settleHint: 2 последних чекина calm/vulva_normal без симптомов охоты, день >= 15", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-10-15")], // 20-й день
    checkins: [
      { day: "2026-11-01", symptoms: ["calm", "vulva_normal"] },
      { day: "2026-11-02", symptoms: ["calm"] },
    ],
  });
  assert.ok(st.openHeat?.settleHint === true, "settleHint должен быть true");
});

test("settleHint: не срабатывает при симптоме охоты в последних чекинах", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-10-15")],
    checkins: [
      { day: "2026-11-01", symptoms: ["calm"] },
      { day: "2026-11-02", symptoms: ["flirty"] },
    ],
  });
  assert.ok(!st.openHeat?.settleHint);
});

test("settleHint: не срабатывает в начале течки (день < 15), даже если спокойная", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-10-30")], // 5-й день
    checkins: [
      { day: "2026-11-01", symptoms: ["calm"] },
      { day: "2026-11-02", symptoms: ["calm", "vulva_normal"] },
    ],
  });
  assert.ok(!st.openHeat?.settleHint);
});

test("settleHint: одного чекина мало", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2026-10-15")],
    checkins: [{ day: "2026-11-02", symptoms: ["calm", "vulva_normal"] }],
  });
  assert.ok(!st.openHeat?.settleHint);
});
