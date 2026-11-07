-- 0002: аватары собак (пользовательские фото, нарисованные на клиенте в квадрат ~256px webp/jpeg).
-- base64-текст вместо BLOB: одинаковый тип через воркер, REST и node:sqlite-харнес, без сюрпризов сериализации.

CREATE TABLE dog_avatars (
  dog_id INTEGER PRIMARY KEY REFERENCES dogs(id),
  mime TEXT NOT NULL,          -- image/webp | image/jpeg | image/png
  data_b64 TEXT NOT NULL,      -- квадрат ≤256px, base64
  updated_at TEXT NOT NULL
);
