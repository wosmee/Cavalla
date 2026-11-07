// Чистая логика списка пользователей для /polz (без grammy/D1) — тестируется node --test.
export const POLZ_PAGE_SIZE = 10;

export interface PolzRow {
  id: number;
  username: string | null;
  pets: string | null; // GROUP_CONCAT кличек через ", "
}

export function formatPolzLine(r: PolzRow): string {
  const who = r.username ? `@${r.username} (${r.id})` : `(${r.id})`;
  return `${who} — ${r.pets ?? "без питомца"}`;
}

// Страница 0-based; page зажимается в допустимый диапазон (список мог измениться между кликами).
export function polzPageInfo(total: number, page: number): { page: number; pages: number; offset: number } {
  const pages = Math.max(1, Math.ceil(total / POLZ_PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { page: p, pages, offset: p * POLZ_PAGE_SIZE };
}

export function polzText(lines: string[], page: number, pages: number, total: number): string {
  if (total === 0) return "Пользователей пока нет.";
  return `Пользователи — стр. ${page + 1}/${pages} (всего ${total})\n\n${lines.join("\n")}`;
}
