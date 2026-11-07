// Тесты породного профиля. node --test worker/test/breeds.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeBreed, sizeClassByBreed, sizeClassByWeight, resolveBreedProfile, SIZE_PROFILES } from "../src/breeds.ts";
import { computeCycleStatus } from "../src/cycle.ts";

const T = "2026-11-05";
const h = (s, e = null) => ({ started_on: s, ended_on: e });

test("normalizeBreed: ё, ъ/ь, дефисы, регистр", () => {
  assert.equal(normalizeBreed("Немецкая овчарка"), "немецкая овчарка");
  assert.equal(normalizeBreed("Йоркширский терьер"), "йоркширский терер");
  assert.equal(normalizeBreed("Шар-Пей"), "шар пей");
  assert.equal(normalizeBreed("  Мопс  "), "мопс");
});

test("точные породы → классы", () => {
  assert.equal(sizeClassByBreed("Немецкая овчарка"), "large");
  assert.equal(sizeClassByBreed("немецкая овчарка"), "large");
  assert.equal(sizeClassByBreed("Лабрадор"), "large");
  assert.equal(sizeClassByBreed("Такса"), "small");
  assert.equal(sizeClassByBreed("Шпиц"), "small");
  assert.equal(sizeClassByBreed("Корги"), "medium");
  assert.equal(sizeClassByBreed("Бигль"), "medium");
  assert.equal(sizeClassByBreed("Немецкий дог"), "giant");
  assert.equal(sizeClassByBreed("Алабай"), "giant");
  assert.equal(sizeClassByBreed("Алобай"), "giant"); // алиас с опечаткой
  assert.equal(sizeClassByBreed("Бассенджи"), "annual");
});

test("разговорные варианты матчатся", () => {
  assert.equal(sizeClassByBreed("немецкая овчарка"), "large");
  assert.equal(sizeClassByBreed("нем. овчарка"), "large");
  assert.equal(sizeClassByBreed("Нем овчарка"), "large");
  assert.equal(sizeClassByBreed("лабик"), "large");
  assert.equal(sizeClassByBreed("Лабадор"), "large");
  assert.equal(sizeClassByBreed("Лапрадор"), "large");
  assert.equal(sizeClassByBreed("ротви"), "large");
  assert.equal(sizeClassByBreed("добик"), "large");
  assert.equal(sizeClassByBreed("йорки"), "small");
  assert.equal(sizeClassByBreed("чихуахуа"), "small");
  assert.equal(sizeClassByBreed("хаська"), "medium");
  assert.equal(sizeClassByBreed("коржи"), "medium");
});

test("дворняга/неизвестное → unknown", () => {
  assert.equal(sizeClassByBreed("дворняжка"), "unknown");
  assert.equal(sizeClassByBreed("метис"), "unknown");
  assert.equal(sizeClassByBreed("не знаю"), "unknown");
  assert.equal(sizeClassByBreed("беспородная"), "unknown");
  assert.equal(sizeClassByBreed("просто собака"), "unknown");
});

test("«мини/той» сгибает класс к small", () => {
  assert.equal(sizeClassByBreed("мини хаски"), "small");
  assert.equal(sizeClassByBreed("той пудель"), "small");
  assert.equal(sizeClassByBreed("карликовый пудель"), "small");
  // дворняга с мини — остаётся unknown (не сгибаем неизвестное)
  assert.equal(sizeClassByBreed("мини дворняжка"), "unknown");
});

test("вес → класс", () => {
  assert.equal(sizeClassByWeight(5000), "small");
  assert.equal(sizeClassByWeight(15000), "medium");
  assert.equal(sizeClassByWeight(35000), "large");
  assert.equal(sizeClassByWeight(60000), "giant");
  assert.equal(sizeClassByWeight(null), null);
  assert.equal(sizeClassByWeight(500), null); // мусор
  assert.equal(sizeClassByWeight(200000), null);
});

test("resolveBreedProfile: порода важнее веса, вес — опора при неизвестной породе", () => {
  assert.equal(resolveBreedProfile("такса", 35000).sizeClass, "small"); // порода выигрывает
  assert.equal(resolveBreedProfile("марсианская", 12000).sizeClass, "medium"); // порода не распознана → вес подстраховал
  assert.equal(resolveBreedProfile("дворняжка", 12000).sizeClass, "unknown"); // дворняга осознанно → дефолты
  assert.equal(resolveBreedProfile(null, null).sizeClass, "unknown");
  assert.equal(resolveBreedProfile("марсианская", null).sizeClass, "unknown");
});

test("прогноз: крупная порода с 1 течкой → 210, hint=false", () => {
  const st = computeCycleStatus({
    today: T, heats: [h("2026-06-05", "2026-06-26")],
    breedProfile: SIZE_PROFILES.large,
  });
  assert.equal(st.nextHeat.expectedOn, "2027-01-01"); // 2026-06-05 + 210
  assert.equal(st.nextHeat.marginDays, 14);
  assert.equal(st.nextHeat.hint, false); // порода даёт опору
  assert.equal(st.breedProfile.sizeClass, "large");
});

test("прогноз: гигант → 280", () => {
  const st = computeCycleStatus({
    today: T, heats: [h("2026-06-05", "2026-06-26")],
    breedProfile: SIZE_PROFILES.giant,
  });
  assert.equal(st.nextHeat.expectedOn, "2027-03-12"); // +280
});

test("прогноз: без породы — старое поведение (180, hint=true)", () => {
  const st = computeCycleStatus({ today: T, heats: [h("2026-06-05", "2026-06-26")] });
  assert.equal(st.nextHeat.expectedOn, "2026-12-02"); // +180
  assert.equal(st.nextHeat.hint, true);
  assert.equal(st.breedProfile.sizeClass, "unknown");
});

test("своя статистика (2+ интервала) важнее породы", () => {
  const st = computeCycleStatus({
    today: T,
    heats: [h("2025-06-05", "2025-06-26"), h("2026-01-01", "2026-01-22"), h("2026-07-20", "2026-08-10")],
    breedProfile: SIZE_PROFILES.large, // порода говорила бы 210
  });
  // медиана интервалов 200/201 → своя статистика
  assert.equal(st.nextHeat.expectedOn, "2027-02-10"); // 2026-07-20 + 201
});

test("порог первой течки по классу: гиганту в 19 мес — норма, не тревога", () => {
  const stG = computeCycleStatus({
    today: T, birthDate: "2025-01-20", heats: [],
    breedProfile: SIZE_PROFILES.giant, // порог 22 мес
  });
  assert.ok(!stG.alerts.some(a => a.kind === "first_heat_late"));

  const stS = computeCycleStatus({
    today: T, birthDate: "2025-01-20", heats: [],
    breedProfile: SIZE_PROFILES.small, // порог 12 мес
  });
  assert.ok(stS.alerts.some(a => a.kind === "first_heat_late"));
});

test("длинный интервал: 380 дн для крупной — норма (порог 400)", () => {
  const heats = [h("2024-12-01", "2024-12-22"), h("2025-12-16", "2026-01-06")]; // интервал 380
  const stL = computeCycleStatus({ today: T, heats, breedProfile: SIZE_PROFILES.large });
  assert.ok(!stL.alerts.some(a => a.kind === "interval_long"));
  const stU = computeCycleStatus({ today: T, heats });
  assert.ok(stU.alerts.some(a => a.kind === "interval_long")); // дефолт 365
});
