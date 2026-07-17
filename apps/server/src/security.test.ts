import { test } from "node:test";
import assert from "node:assert/strict";
import { safeEqual, checkAuth, RateLimiter } from "./security.js";

test("safeEqual: đúng/sai/khác độ dài", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});

test("checkAuth: không cấu hình token -> dev mode cho qua", () => {
  assert.equal(checkAuth(undefined, undefined), true);
  assert.equal(checkAuth("Bearer x", undefined), true);
});

test("checkAuth: có token -> phải khớp Bearer", () => {
  assert.equal(checkAuth("Bearer secret", "secret"), true);
  assert.equal(checkAuth("Bearer wrong", "secret"), false);
  assert.equal(checkAuth(undefined, "secret"), false);
  assert.equal(checkAuth("secret", "secret"), false); // thiếu "Bearer "
});

test("RateLimiter: chặn sau khi vượt hạn mức trong cửa sổ", () => {
  const rl = new RateLimiter(3, 60_000);
  assert.equal(rl.allow("ip1"), true);
  assert.equal(rl.allow("ip1"), true);
  assert.equal(rl.allow("ip1"), true);
  assert.equal(rl.allow("ip1"), false); // lần thứ 4 bị chặn
  assert.equal(rl.allow("ip2"), true); // IP khác không ảnh hưởng
});
