// Тесты KV-кэша цикла (api.ts cycleStatus + bumpCycleVersion, фейковые D1/KV + node:sqlite).
// Прогон: node --test worker/test/cachecache.test.mjs
// (грабля проекта: импорты .ts между src-файлами обязательны для node — NEXT_SESSION.md)
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "fs";

const db = new DatabaseSync(":memory:");
for (const f of ["0001_init.sql", "0002_dog_avatars.sql", "0003_cron_lock.sql", "0004_cycle_cache.sql"]) {
  db.exec(fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
}

// фейковые D1/KV с bind-порядком, списанным из api.ts дословно
function makeDb(db) {
  const stmts = new Map();
  return {
    calls: [],
    prepare(sql) {
      if (!stmts.has(sql)) stmts.set(sql, db.prepare(sql));
      const native = stmts.get(sql);
      return {
        bind(...args) {
          const bound = { sql, args };
          return {
            first: async () => db.prepare(sql).all(...args)[0] ?? null,
            all: async () => ({ results: db.prepare(sql).all(...args) }),
            run: async () => { db.prepare(sql).run(...args); return { meta: { changes: 1 } }; },
          };
        },
        first: async () => native.all()[0] ?? null,
        all: async () => ({ results: native.all() }),
        run: async () => { native.run(); return { meta: { changes: 1 } }; },
      };
    },
    async batch(list) {
      const out = [];
      for (const s of list) out.push(await s.run());
      return out;
    },
  };
}
const kvStore = new Map();
const kv = {
  get: async k => kvStore.get(k) ?? null,
  put: async (k, v) => { kvStore.set(k, v); },
  delete: async k => { kvStore.delete(k); },
};

const env = { DB: makeDb(db), KV: kv, BOT_TOKEN: "x", WEBHOOK_SECRET: "s" };
import { cycleStatus, bumpCycleVersion } from "../src/api.ts";
// собака + открытая течка + чекин; даты относительные — day течки не должен зависеть от дня прогона
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const heatStart = iso(new Date(today.getTime() - 8 * 86400000)); // day 9 на сегодня
const checkinDay = iso(today);
env.DB.prepare("INSERT INTO users (id, username, first_seen_at, last_seen_at) VALUES (1, 'u', '2026-01-01', '2026-01-01')").run();
env.DB.prepare("INSERT INTO dogs (owner_id, name, breed, created_at) VALUES (1, 'Тест', 'такса', '2026-01-01')").run();
env.DB.prepare(`INSERT INTO heats (dog_id, started_on, note, created_at) VALUES (1, '${heatStart}', null, '${heatStart}')`).run();
env.DB.prepare(`INSERT INTO daily_checkins (dog_id, day, symptoms, note, created_at, updated_at) VALUES (1, '${checkinDay}', '["discharge_light"]', null, '${checkinDay}', '${checkinDay}')`).run();

test("мисс при нулевой версии (собака до 0004) — без кэша, прямо D1", async () => {
  assert.equal(kvStore.size, 0);
  const st1 = await cycleStatus(env, 1);
  assert.equal(st1.inHeat, true);
  assert.equal(st1.openHeat.day, 9);
  // фаза estrus по симптому discharge_light
  assert.equal(st1.openHeat.phase, "estrus");
  assert.equal(st1.openHeat.phaseSource, "symptoms");
  assert.equal(kvStore.size, 0); // версия 0 — не кэшируем
});

test("мутация через bump → версия 1 → запись в KV → хит из KV", async () => {
  await env.DB.batch([bumpCycleVersion(env, 1)]);
  const st = await cycleStatus(env, 1);
  assert.equal(st.inHeat, true);
  assert.equal(kvStore.size, 1);
  assert.match([...kvStore.keys()][0], /^cycle:1:1$/);
  // хит: тот же ответ из KV
  const st2 = await cycleStatus(env, 1);
  assert.deepEqual(st2, st);
  assert.equal(kvStore.size, 1);
});

test("вторая мутация → версия 2 → новый ключ, читается только он", async () => {
  await env.DB.batch([bumpCycleVersion(env, 1)]);
  const st = await cycleStatus(env, 1);
  assert.equal(st.inHeat, true);
  const keys = [...kvStore.keys()];
  assert.equal(keys.length, 2);
  assert.ok(keys.includes("cycle:1:2"));
  // подменим старый ключ: чтение обязано идти по новой версии
  kvStore.set("cycle:1:1", '{"injected": true}');
  const st2 = await cycleStatus(env, 1);
  assert.equal(st2.inHeat, true);
  assert.notEqual(st2.injected, true);
});

test("KV недоступен (get/put бросают) — прозрачный фолбэк в D1", async () => {
  const brokenKv = {
    get: async () => { throw new Error("kv down"); },
    put: async () => { throw new Error("kv down"); },
    delete: async () => {},
  };
  const st = await cycleStatus({ ...env, KV: brokenKv }, 1);
  assert.equal(st.inHeat, true);
  assert.equal(st.stats.heatsCount, 1);
});
