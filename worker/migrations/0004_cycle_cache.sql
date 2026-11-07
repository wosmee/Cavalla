-- 0004: версия данных цикла собаки для KV-кэша GET /api/dogs/:id/cycle.
-- cycle_version меняется той же db.batch-операцией, что и мутации (течки/чекины/профиль),
-- ключ кэша = cycle:<dog_id>:<version> — старые записи просто протухают по TTL.
-- Индексы закрывают 3 запроса cycleStatus: heats и checkins по dog_id (у heats ещё
-- сортировка по started_on — покрывается вторым столбцом индекса).

ALTER TABLE dogs ADD COLUMN cycle_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_heats_dog_started ON heats (dog_id, started_on);
CREATE INDEX IF NOT EXISTS idx_checkins_dog_day ON daily_checkins (dog_id, day);
