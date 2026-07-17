import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "./conversation.js";

test("Conversation: add + toModelMessages giữ đúng thứ tự/role", () => {
  const c = new Conversation();
  c.add("user", "chào");
  c.add("assistant", "chào bạn");
  assert.equal(c.length, 2);
  assert.deepEqual(c.toModelMessages(), [
    { role: "user", content: "chào" },
    { role: "assistant", content: "chào bạn" },
  ]);
});

test("Conversation: maxMessages cắt bớt lượt cũ nhất", () => {
  const c = new Conversation([], 4);
  for (let i = 0; i < 10; i++) c.add(i % 2 === 0 ? "user" : "assistant", String(i));
  assert.equal(c.length, 4);
  // 4 tin nhắn cuối là 6,7,8,9
  assert.deepEqual(
    c.messages().map((m) => m.content),
    ["6", "7", "8", "9"],
  );
});

test("Conversation: clear xoá sạch", () => {
  const c = new Conversation();
  c.add("user", "x");
  c.clear();
  assert.equal(c.length, 0);
});
