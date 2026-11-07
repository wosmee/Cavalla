-- 0005: жалобы пользователей и авто-репорты ошибок (поддержка).
-- kind: manual — пользователь написал сам (кнопка-конверт), error — window.onerror/
-- unhandledrejection из мини-аппа, server — необработанное исключение воркера.
-- fingerprint — FNV-1a от первой строки ошибки + экрана: дедуп повторов (один
-- уникальный баг = одна строка, seen_count растёт, уведомление раз в сутки).
-- owner_msg_id — message_id последнего уведомления владельцу: по нему работает
-- reply-тред («ответить на это сообщение» → доставить пользователю).
-- dog_name денормализовано: собаку могут архивировать до разбора жалобы.

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_user_id INTEGER NOT NULL,
  username TEXT,
  dog_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'error', 'server')),
  text TEXT NOT NULL,
  page TEXT,
  bundle_ver TEXT,
  fingerprint TEXT,
  seen_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'replied', 'resolved')),
  owner_msg_id INTEGER,
  last_notify_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_fp ON reports (fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status, id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON reports (tg_user_id, status);

-- режим «Ответить»: владелец нажал кнопку — следующее его текстовое сообщение
-- уходит пользователю. В D1, не KV: read-after-write нужен мгновенный (§35).
CREATE TABLE IF NOT EXISTS support_flags (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
