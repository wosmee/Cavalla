-- 0001: базовая схема Cavalla
-- Схема рассчитана на мульти-собак и нескольких пользователей с первого дня.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,              -- telegram user id
  username TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  notify_settings TEXT NOT NULL DEFAULT '{}'  -- JSON: тумблеры уведомлений (opt-in)
);

CREATE TABLE dogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  breed TEXT,
  birth_date TEXT,                      -- ISO дата
  weight_grams INTEGER,
  created_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);

-- Периоды течки: начало и окончание. Окончание NULL = идёт сейчас.
CREATE TABLE heats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dog_id INTEGER NOT NULL REFERENCES dogs(id),
  started_on TEXT NOT NULL,             -- ISO дата (день, не datetime)
  ended_on TEXT,                        -- NULL пока идёт
  note TEXT,
  created_at TEXT NOT NULL
);

-- Ежедневные чекины симптомов. Один чекин на собаку в день.
CREATE TABLE daily_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dog_id INTEGER NOT NULL REFERENCES dogs(id),
  day TEXT NOT NULL,                    -- ISO дата
  symptoms TEXT NOT NULL DEFAULT '[]',  -- JSON: массив ключей симптомов
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (dog_id, day)
);

CREATE INDEX idx_dogs_owner ON dogs(owner_id);
CREATE INDEX idx_heats_dog ON heats(dog_id, started_on);
CREATE INDEX idx_checkins_dog_day ON daily_checkins(dog_id, day);
