// Прогноз-движок Cavalla. Чистая логика без I/O: один и тот же код работает
// в воркере (API + крон уведомлений) и в Node-тестах. Предметная основа —
// заметка проекта (ветфорумы: фазы, интервалы, пороги тревоги).
// Даты — календарные дни 'YYYY-MM-DD', вся арифметика в UTC.
// Породные пороги (интервал-приор, порог первой течки, длинного интервала) —
// вход breedProfile; при null действуют глобальные константы ниже.

import type { BreedProfile } from "./breeds.ts";
import { SIZE_PROFILES } from "./breeds.ts";

export interface HeatRecord { started_on: string; ended_on: string | null; note?: string | null; }
export interface CheckinRecord { day: string; symptoms: string[]; }

export interface CycleInput {
  today: string;
  birthDate?: string | null;
  heats: HeatRecord[];          // порядок любой
  checkins?: CheckinRecord[];   // симптомы дня (ключи см. ESTRUS_SYMPTOMS)
  breedProfile?: BreedProfile | null; // порода/вес собаки → пороги (см. breeds.ts)
}

export type Phase = "proestrus" | "estrus" | "late" | "overdue";
export type Confidence = "low" | "medium" | "high";
export type AlertKind =
  | "heat_long"       // признаки течки дольше 30 дн — к ветеринару
  | "no_heat_long"    // нет течки дольше 12 мес у взрослой суки
  | "first_heat_late" // первая течка не наступила к 18 мес
  | "interval_short"  // исторический интервал подозрительно короткий
  | "interval_long"   // исторический интервал дольше 12 мес
  | "pus_discharge";  // гнойные выделения в чекинах — возможная пиометра, срочно к вету
export interface CycleAlert { kind: AlertKind; days?: number; months?: number; }
export interface Window { from: string; to: string; }

export interface OpenHeatInfo {
  started_on: string;
  day: number;                       // день течки (1-й = день начала)
  phase: Phase;
  phaseSource: "days" | "symptoms";  // симптомы важнее счёта дней
  estrusWindow: Window;              // окно охоты
  expectedEndOn: string;             // ожидаемое окончание течки
  settleHint: boolean;               // 2+ дня подряд «спокойная + петля в норме» — похоже, закончилась (диэструс)
}

export interface NextHeatForecast {
  expectedOn: string;    // медианная дата
  from: string;          // окно ± margin
  to: string;
  marginDays: number;
  confidence: Confidence;
  hint: boolean;         // «внесите ещё цикл для точности»
  overdueDays: number;   // >0 если сегодня за пределами окна
}

export interface HeatStat {
  started_on: string;
  ended_on: string | null;
  durationDays: number | null;
  intervalToPrev: number | null;     // дней от начала предыдущей
  note: string | null;               // заметка владельца к течке
}

export interface CycleStatus {
  today: string;
  inHeat: boolean;
  openHeat: OpenHeatInfo | null;
  nextHeat: NextHeatForecast | null;
  daysToNext: number | null;         // до начала окна; null если окно позади
  postHeatWatch: PostHeatWatch | null; // окно «после течки»: ложная щенность 30–60 дн
  breedProfile: BreedProfile;        // применённые породные пороги (unknown = глобальные)
  stats: {
    heatsCount: number;
    avgDurationDays: number | null;
    medianIntervalDays: number | null;
    spreadDays: number | null;       // разброс интервалов (max−min)
    regularity: "very-stable" | "stable" | "irregular" | null;
  };
  heats: HeatStat[];                 // отсортированы по started_on
  alerts: CycleAlert[];
}

// после закрытия течки: 30–70 дн возможно появление признаков ложной щенности
export interface PostHeatWatch {
  since: string;      // ended_on последней закрытой течки
  from: string;       // 30 дн после ended_on
  to: string;         // 60 дн после ended_on
  inWindow: boolean;  // сегодня внутри окна
}

// Предметные константы (ветсправочники, сводка в заметке проекта).
export const PROESTRUS_DAYS = 9;        // дни 1–9
export const ESTRUS_LAST_DAY = 15;      // дни 10–15
export const HEAT_NORM_DAYS = 21;       // ~3 недели
export const HEAT_LONG_DAYS = 30;       // признаки >30 дн — к вету (Royal Canin, Vet Union)
export const GLOBAL_INTERVAL_DAYS = 180; // норма «в среднем по породам», для 1 течки
export const ONE_INTERVAL_MARGIN = 14;   // честный широкий интервал при малой истории
export const INTERVAL_SHORT_ALERT = 100; // <~3.5 мес
export const INTERVAL_LONG_ALERT = 365;  // >12 мес
export const FIRST_HEAT_LATE_MONTHS = 18;
// Симптом-ключи из чекинов (значения согласованы с index.html SYMPTOMS_HEAT/SYMPTOMS_OUT).
export const ESTRUS_SYMPTOMS: readonly string[] = ["discharge_light", "flirty", "tail_tuck"];
export const PUS_SYMPTOM = "discharge_pus";           // гнойные выделения — красная тревога
// Закрытая пиометра часто БЕЗ выделений: жажда + потеря аппетита + вялость/беспокойство
// в 1–8 недель после течки — сочетание 2+ из них в окне тоже триггерит вет-тревогу.
export const PUS_RISK_SYMPTOMS: readonly string[] = ["drinking", "appetite_less", "restless"];
export const PUS_RISK_MIN_SYMPTOMS = 2;
export const POSTHEAT_WATCH_FROM = 30;                // ложная щенность: от 30 дн после окончания
export const POSTHEAT_WATCH_TO = 60;
export const PUS_RISK_FROM = 7;                       // закрытая пиометра: окно риска после окончания
export const PUS_RISK_TO = 60;

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toDay(s: string): number {
  const m = ISO.exec(s);
  if (!m) throw new Error(`bad date: ${s}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
export function fromDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function dayDiff(a: string, b: string): number {
  return Math.round((toDay(a) - toDay(b)) / DAY_MS);
}
function addDays(s: string, n: number): string {
  return fromDay(toDay(s) + n * DAY_MS);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function mean(xs: number[]): number {
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export function computeCycleStatus(input: CycleInput): CycleStatus {
  const today = input.today;
  const breed = input.breedProfile ?? SIZE_PROFILES.unknown;
  const heats = [...input.heats].sort((a, b) =>
    a.started_on < b.started_on ? -1 : a.started_on > b.started_on ? 1 : 0
  );
  const alerts: CycleAlert[] = [];

  // длительности закрытых течек и интервалы между началами
  const durations: number[] = [];
  for (const h of heats) {
    if (h.ended_on) durations.push(dayDiff(h.ended_on, h.started_on) + 1);
  }
  const intervals: number[] = [];
  for (let i = 1; i < heats.length; i++) {
    intervals.push(dayDiff(heats[i].started_on, heats[i - 1].started_on));
  }
  const avgDuration = durations.length ? mean(durations) : null;
  const medianInterval = intervals.length ? median(intervals) : null;
  const spread = intervals.length >= 2 ? Math.max(...intervals) - Math.min(...intervals) : null;
  const regularity =
    intervals.length >= 2
      ? spread! <= 7 ? "very-stable" : spread! <= 21 ? "stable" : "irregular"
      : null;

  // открытая течка — последняя без ended_on
  let openRec: HeatRecord | null = null;
  for (let i = heats.length - 1; i >= 0; i--) {
    if (heats[i].ended_on === null) { openRec = heats[i]; break; }
  }

  let openHeat: OpenHeatInfo | null = null;
  if (openRec) {
    const day = dayDiff(today, openRec.started_on) + 1;
    if (day >= 1) {
      // симптомный сдвиг: первый день течки с признаком охоты
      let symDay: string | null = null;
      for (const c of input.checkins ?? []) {
        if (c.day >= openRec.started_on && c.day <= today && c.symptoms.some(s => ESTRUS_SYMPTOMS.includes(s))) {
          if (!symDay || c.day < symDay) symDay = c.day;
        }
      }
      let phase: Phase;
      let phaseSource: "days" | "symptoms";
      let estrusWindow: Window;
      if (symDay) {
        const after = dayDiff(today, symDay);
        phase = after <= 9 ? "estrus" : "late";
        phaseSource = "symptoms";
        estrusWindow = { from: symDay, to: addDays(symDay, 8) };
      } else {
        phase = day <= PROESTRUS_DAYS ? "proestrus"
          : day <= ESTRUS_LAST_DAY ? "estrus"
          : day <= HEAT_NORM_DAYS ? "late"
          : "overdue";
        phaseSource = "days";
        estrusWindow = { from: addDays(openRec.started_on, 8), to: addDays(openRec.started_on, 14) };
      }
      const expectedEndOn = addDays(openRec.started_on, (avgDuration ?? HEAT_NORM_DAYS) - 1);
      if (day >= HEAT_LONG_DAYS) alerts.push({ kind: "heat_long", days: day });
      // «успокоение»: 2+ последних чекина подряд с calm и/или vulva_normal и без
      // симптомов охоты — признак диэструса («снова спокойная и послушная, петля
      // уменьшается» — Зоостатус/Hill's). Мягкий хинт «закрыть течку», не тревога.
      let settleHint = false;
      const recent = (input.checkins ?? [])
        .filter(c => c.day >= openRec.started_on && c.day <= today)
        .sort((a, b) => a.day < b.day ? 1 : -1)
        .slice(0, 2);
      if (recent.length === 2
        && recent.every(c =>
          (c.symptoms.includes("calm") || c.symptoms.includes("vulva_normal"))
          && !c.symptoms.some(s => ESTRUS_SYMPTOMS.includes(s)))
        && day >= ESTRUS_LAST_DAY) {
        settleHint = true;
      }
      openHeat = { started_on: openRec.started_on, day, phase, phaseSource, estrusWindow, expectedEndOn, settleHint };
    }
  }

  // прогноз следующей течки — от начала последней + медиана интервалов
  const lastStart = heats.length ? heats[heats.length - 1].started_on : null;
  let nextHeat: NextHeatForecast | null = null;
  let daysToNext: number | null = null;
  if (lastStart) {
    const ivl = medianInterval ?? breed.intervalDays; // порода/вес — приор при малой истории
    const expectedOn = addDays(lastStart, ivl);
    let marginDays: number;
    let confidence: Confidence;
    let hint: boolean;
    if (intervals.length >= 2) {
      marginDays = Math.min(30, Math.max(7, spread!));
      confidence = spread! <= 7 ? "high" : spread! <= 14 ? "medium" : "low";
      hint = false;
    } else {
      marginDays = ONE_INTERVAL_MARGIN;
      confidence = "low";
      hint = intervals.length === 0 && breed.sizeClass === "unknown"; // глобальная норма без опоры на породу
    }
    const from = addDays(expectedOn, -marginDays);
    const to = addDays(expectedOn, marginDays);
    const overdueDays = today > to ? dayDiff(today, to) : 0;
    if (today < from) daysToNext = dayDiff(from, today);
    else if (today <= to) daysToNext = 0;
    nextHeat = { expectedOn, from, to, marginDays, confidence, hint, overdueDays };
  }

  // тревога-симптом: гнойные выделения в чекине после начала последней течки
  // (пиометра чаще всего проявляется через 1–2 мес после течки — «срочно к вету», без диагноза)
  if (lastStart) {
    const pusDay = (input.checkins ?? []).some(c =>
      c.day >= lastStart && c.day <= today && c.symptoms.includes(PUS_SYMPTOM)
    );
    if (pusDay) alerts.push({ kind: "pus_discharge" });
  }

  // закрытая пиометра без выделений: в окне 7–60 дн после закрытия последней течки
  // сочетание 2+ интоксикационных симптомов (жажда, потеря аппетита, вялость/беспокойство)
  // в один и тот же день — тоже повод «покажите ветеринару», мягче чем гной
  const lastClosedForPus = [...heats].reverse().find(h => h.ended_on !== null);
  if (lastClosedForPus?.ended_on && !openHeat) {
    const riskFrom = addDays(lastClosedForPus.ended_on, PUS_RISK_FROM);
    const riskTo = addDays(lastClosedForPus.ended_on, PUS_RISK_TO);
    const riskDay = (input.checkins ?? []).some(c =>
      c.day >= riskFrom && c.day <= riskTo && c.day <= today
      && c.symptoms.filter(s => PUS_RISK_SYMPTOMS.includes(s)).length >= PUS_RISK_MIN_SYMPTOMS
    );
    if (riskDay) alerts.push({ kind: "pus_discharge" });
  }

  // окно «после течки» (ложная щенность 30–70 дн после окончания)
  let postHeatWatch: PostHeatWatch | null = null;
  const lastClosed = [...heats].reverse().find(h => h.ended_on !== null);
  if (lastClosed?.ended_on) {
    const since = lastClosed.ended_on;
    const from = addDays(since, POSTHEAT_WATCH_FROM);
    const to = addDays(since, POSTHEAT_WATCH_TO);
    postHeatWatch = { since, from, to, inWindow: today >= from && today <= to };
  }

  // тревожные подсказки (без диагнозов — «покажите ветеринару»)
  if (!openHeat && lastStart) {
    const since = dayDiff(today, lastStart);
    if (since > INTERVAL_LONG_ALERT) alerts.push({ kind: "no_heat_long", days: since });
  }
  if (input.birthDate && heats.length === 0) {
    const months = Math.floor(dayDiff(today, input.birthDate) / 30.44);
    if (months >= breed.firstHeatLateMonths) alerts.push({ kind: "first_heat_late", months });
  }
  for (const iv of intervals) {
    if (iv < breed.intervalShortAlert) alerts.push({ kind: "interval_short", days: iv });
    else if (iv > breed.intervalLongAlert) alerts.push({ kind: "interval_long", days: iv });
  }

  const heatStats: HeatStat[] = heats.map((h, i) => ({
    started_on: h.started_on,
    ended_on: h.ended_on,
    durationDays: h.ended_on ? dayDiff(h.ended_on, h.started_on) + 1 : null,
    intervalToPrev: i > 0 ? dayDiff(h.started_on, heats[i - 1].started_on) : null,
    note: h.note ?? null,
  }));

  return {
    today,
    inHeat: !!openHeat,
    openHeat,
    nextHeat,
    daysToNext,
    postHeatWatch,
    breedProfile: breed,
    stats: {
      heatsCount: heats.length,
      avgDurationDays: avgDuration,
      medianIntervalDays: medianInterval,
      spreadDays: spread,
      regularity,
    },
    heats: heatStats,
    alerts,
  };
}
