import { test } from "node:test";
import assert from "node:assert/strict";
import { SentenceChunker } from "./chunk.js";

test("SentenceChunker: cắt câu tại dấu kết câu", () => {
  const c = new SentenceChunker();
  assert.deepEqual(c.push("Xin chào. Bạn kh"), ["Xin chào."]);
  assert.deepEqual(c.push("oẻ không? Tạm biệt"), ["Bạn khoẻ không?"]);
  assert.equal(c.flush(), "Tạm biệt");
});

test("SentenceChunker: nhiều câu trong một delta; câu cuối chưa có khoảng trắng ra ở flush", () => {
  const c = new SentenceChunker();
  // "C?" cuối chuỗi chưa có whitespace theo sau -> giữ lại (tránh cắt nhầm "3.14")
  assert.deepEqual(c.push("A. B! C?"), ["A.", "B!"]);
  assert.equal(c.flush(), "C?");
});

test("SentenceChunker: không cắt số thập phân giữa chừng", () => {
  const c = new SentenceChunker();
  assert.deepEqual(c.push("Kết quả là 3.14 nhé."), []);
  assert.equal(c.flush(), "Kết quả là 3.14 nhé.");
});

test("SentenceChunker: xuống dòng cũng là ranh giới", () => {
  const c = new SentenceChunker();
  assert.deepEqual(c.push("dòng một\ncòn lại"), ["dòng một"]);
  assert.equal(c.flush(), "còn lại");
});
