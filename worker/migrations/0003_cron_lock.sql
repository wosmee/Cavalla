-- 0003: лок дневного крона уведомлений. /cron?secret= и scheduled могут сработать
-- параллельно → дубли сообщений юзерам. Каждое выполнение берёт строку лока:
-- INSERT игнорируется, если свежий лок (< 50 мин) уже есть.

CREATE TABLE IF NOT EXISTS cron_locks (
  name TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL
);
