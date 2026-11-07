// Уведомления Cavalla: крон раз в день. Решения — чистая функция (Node-тесты),
// клей к D1/Telegram — runDailyNotifications. Все тексты — мягкие, без диагнозов.
import { computeCycleStatus, dayDiff, type CycleStatus } from "./cycle.ts";
import { resolveBreedProfile } from "./breeds.ts";
import type { Env } from "./types";

export interface NotifySettings {
  enabled?: boolean;
  advance_days?: number;
  day_of_heat?: boolean;
  checkin_reminder?: boolean;
}

export type NotifKind =
  | "advance" | "day_of_heat" | "checkin_reminder" | "overdue"
  | "pus_discharge"   // гнойные выделения — срочно к вету
  | "postheat_watch"  // окно ложной щенности после закрытой течки
  | "close_nudge";    // открытая течка длиннее ожидаемой — закрой, если закончилась
export interface Notif { kind: NotifKind; text: string }

// «сегодня» для RU-аудитории: MSK-день (UTC+3), чтобы чекин в 00:00–02:59 мск не уходил во вчера
export function dayMsk(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

export function decideNotifications(
  st: CycleStatus,
  notify: NotifySettings,
  hasCheckinToday: boolean
): Notif[] {
  const out: Notif[] = [];
  if (notify.enabled === false) return out;

  // красная тревога-симптом (пиометра) — независимо от тумблеров, кроме полного opt-out.
  // Приходит и по гною, и по сочетанию жажда+аппетит+вялость после течки (закрытая форма).
  if (st.alerts.some(a => a.kind === "pus_discharge")) {
    out.push({
      kind: "pus_discharge",
      text: "⚠️ После течки у собаки признаки, которые нельзя игнорировать: гнойные выделения из петли, или сильная жажда с потерей аппетита и вялостью. Это может быть гнойное воспаление матки (пиометра) — она бывает и БЕЗ выделений. Заболевание лечится, но время критично: покажите собаку ветеринару в ближайшие дни.",
    });
  }

  if (st.inHeat) {
    if (notify.checkin_reminder && !hasCheckinToday) {
      out.push({
        kind: "checkin_reminder",
        text: `🐶 ${st.openHeat!.day}-й день течки. Как она сегодня? Открой Cavalla и отметь пару симптомов — прогноз станет точнее.`,
      });
    }
    // открытая течка переросла ожидаемое окончание — закрой, чтобы прогноз не портился.
    // Раз в 3 дня (день 1, 4, 7… просрочки), чтобы не спамить при длинной течке.
    const oh = st.openHeat!;
    if (notify.enabled && oh.day > 0 && st.today > oh.expectedEndOn) {
      const overdue = dayDiff(st.today, oh.expectedEndOn);
      if (overdue % 3 === 1) {
        out.push({
          kind: "close_nudge",
          text: `🐶 Течка длится уже ${oh.day} дн. (дольше ожидаемых ~${st.stats.avgDurationDays ?? 21}). Если выделения закончились и петля уменьшилась — закрой течку в Cavalla, прогноз станет точнее.`,
        });
      }
    }
    return out;
  }

  // течки нет: окно «после течки» — мягкая карточка про ложную щенность
  if (notify.enabled && st.postHeatWatch?.inWindow) {
    out.push({
      kind: "postheat_watch",
      text: "💤 Через 1–2 месяца после течки у некоторых сук бывает «ложная щенность»: набухают молочные железы, собака устраивает «гнездо», иногда появляется молоко. Это гормональная норма, но если молока много или собака вялая — покажите ветеринару.",
    });
  }

  // течки нет: ждём следующую
  if (st.nextHeat) {
    if (notify.day_of_heat && st.nextHeat.expectedOn === st.today) {
      out.push({
        kind: "day_of_heat",
        text: "📅 По твоим записям, у собаки сегодня должен начаться цикл. Если видишь признаки — отметь начало течки в Cavalla.",
      });
    }
    if (notify.enabled && st.daysToNext !== null && st.daysToNext === (notify.advance_days ?? 7)) {
      out.push({
        kind: "advance",
        text: `📅 Ожидаемая течка через ${st.daysToNext} дн. (окно ${fmt(st.nextHeat.from)} — ${fmt(st.nextHeat.to)}).`,
      });
    }
    if (notify.enabled && st.nextHeat.overdueDays > 0) {
      // раз в ~7 дней, чтобы не спамить каждый день: напоминаем на 1, 8, 15... день просрочки
      if ((st.nextHeat.overdueDays - 1) % 7 === 0) {
        out.push({
          kind: "overdue",
          text: `📅 Расчётная течка не наступила (окно закрылось ${st.nextHeat.overdueDays} дн. назад). Разовые смещения — норма; если началась — отметь в Cavalla. Долго нет течки — стоит показаться ветеринару.`,
        });
      }
    }
  }
  return out;
}

const MONTHS_RU = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function fmt(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_RU[m - 1]}${y !== new Date().getFullYear() ? " " + y : ""}`;
}

// --- клей: одна итерация дневного крона ---
// лок в D1: /cron?secret= и scheduled не должны сработать параллельно — иначе
// дубли уведомлений. Лок живёт 50 мин (< интервал запуска), протухший берётся свободно.
export async function tryAcquireCronLock(env: Env, name = "daily"): Promise<boolean> {
  const now = new Date();
  const freshUntil = new Date(now.getTime() - 50 * 60_000).toISOString();
  const r = await env.DB.prepare(
    `INSERT INTO cron_locks (name, taken_at) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET taken_at = excluded.taken_at
     WHERE cron_locks.taken_at < ?`
  ).bind(name, now.toISOString(), freshUntil).run();
  // upsert с WHERE либо вставил/обновил строку, либо 0 rows — значит, свежий лок занят
  const changes = Number(r.meta?.changes ?? 0);
  return changes > 0;
}

export async function runDailyNotifications(env: Env): Promise<{ sent: number; errors: number; blocked: number; locked?: boolean }> {
  if (!(await tryAcquireCronLock(env))) {
    console.log("notify: fresh lock — another run is in progress, skipping");
    return { sent: 0, errors: 0, blocked: 0, locked: true };
  }
  const today = dayMsk();
  const users = (await env.DB.prepare(
    "SELECT id, notify_settings FROM users"
  ).all<{ id: number; notify_settings: string | null }>()).results;
  let sent = 0, errors = 0, blocked = 0;

  // задачи считаем последовательно (чтения лёгкие), а доставку шлём параллельно —
  // последовательные await на каждый sendMessage упираются в wallclock воркера
  // уже на паре десятков юзеров
  const jobs: Promise<void>[] = [];
  for (const u of users) {
    let notify: NotifySettings;
    try { notify = JSON.parse(u.notify_settings || "{}") as NotifySettings; } catch { notify = {}; }
    if (!notify.enabled && !notify.day_of_heat && !notify.checkin_reminder) continue;

    const dogs = (await env.DB.prepare(
      "SELECT id, name, birth_date, breed, weight_grams FROM dogs WHERE owner_id = ? AND archived = 0"
    ).bind(u.id).all<{ id: number; name: string; birth_date: string | null; breed: string | null; weight_grams: number | null }>()).results;

    for (const dog of dogs) {
      const heats = (await env.DB.prepare(
        "SELECT started_on, ended_on FROM heats WHERE dog_id = ? ORDER BY started_on"
      ).bind(dog.id).all<{ started_on: string; ended_on: string | null }>()).results;
      if (!heats.length) continue;
      const lastStart = heats[heats.length - 1].started_on;
      const checkins = (await env.DB.prepare(
        "SELECT day, symptoms FROM daily_checkins WHERE dog_id = ? AND day >= ? ORDER BY day"
      ).bind(dog.id, lastStart).all<{ day: string; symptoms: string }>()).results
        .map(r => ({ day: r.day, symptoms: JSON.parse(r.symptoms) as string[] }));
      const st = computeCycleStatus({
        today, birthDate: dog.birth_date, heats, checkins,
        breedProfile: resolveBreedProfile(dog.breed, dog.weight_grams),
      });
      const hasCheckinToday = checkins.some(c => c.day === today);

      for (const n of decideNotifications(st, notify, hasCheckinToday)) {
        const text = `🐾 ${dog.name}\n${n.text}`;
        jobs.push((async () => {
          try {
            const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ chat_id: u.id, text }),
            }).then(r => r.json() as Promise<{ ok: boolean; description?: string; error_code?: number }>);
            if (r.ok) {
              sent++;
            } else if (r.error_code === 403) {
              // бот заблокирован юзером — доставить нельзя никогда: выключаем уведомления,
              // чтобы не копить errors и не слать вечно (как §56 у Ногтей)
              errors++;
              blocked++;
              const off = { ...notify, enabled: false };
              await env.DB.prepare("UPDATE users SET notify_settings = ? WHERE id = ?")
                .bind(JSON.stringify(off), u.id).run().catch(() => {});
              console.log(`notify: user ${u.id} blocked bot, notifications disabled`);
            } else {
              errors++;
            }
          } catch {
            errors++; // доставка чинится следующим прогоном крона; вебхук не касается
          }
        })());
      }
    }
  }
  await Promise.all(jobs);
  console.log(`notify: sent=${sent} errors=${errors} blocked=${blocked}`);
  return { sent, errors, blocked };
}
