// Тесты формата /polz. node --test worker/test/polz.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { POLZ_PAGE_SIZE, formatPolzLine, polzPageInfo, polzText } from "../src/polz.ts";

test("строка: username + id + клички", () => {
  assert.equal(formatPolzLine({ id: 673947355, username: "wqqut", pets: "Леха" }), "@wqqut (673947355) — Леха");
});

test("строка: несколько кличек через запятую", () => {
  assert.equal(
    formatPolzLine({ id: 1, username: "a", pets: "Лонда, Леха" }),
    "@a (1) — Лонда, Леха"
  );
});

test("строка: без username — только id в скобках", () => {
  assert.equal(formatPolzLine({ id: 6354919342, username: null, pets: "Лонда" }), "(6354919342) — Лонда");
});

test("строка: без питомца", () => {
  assert.equal(formatPolzLine({ id: 5, username: null, pets: null }), "(5) — без питомца");
});

test("размер страницы = 10", () => {
  assert.equal(POLZ_PAGE_SIZE, 10);
});

test("polzPageInfo: пустой список → одна страница", () => {
  assert.deepEqual(polzPageInfo(0, 0), { page: 0, pages: 1, offset: 0 });
});

test("polzPageInfo: 25 юзеров → 3 страницы, offset по странице", () => {
  assert.deepEqual(polzPageInfo(25, 0), { page: 0, pages: 3, offset: 0 });
  assert.deepEqual(polzPageInfo(25, 2), { page: 2, pages: 3, offset: 20 });
});

test("polzPageInfo: page зажимается в диапазон (список мог измениться между кликами)", () => {
  assert.deepEqual(polzPageInfo(25, 99), { page: 2, pages: 3, offset: 20 });
  assert.deepEqual(polzPageInfo(25, -3), { page: 0, pages: 3, offset: 0 });
});

test("polzText: заголовок со страницей и числом, пустой список", () => {
  assert.equal(polzText([], 0, 1, 0), "Пользователей пока нет.");
  const t = polzText(["@a (1) — Леха", "(2) — без питомца"], 1, 3, 25);
  assert.match(t, /стр\. 2\/3/);
  assert.match(t, /всего 25/);
  assert.match(t, /@a \(1\) — Леха\n\(2\) — без питомца/);
});
