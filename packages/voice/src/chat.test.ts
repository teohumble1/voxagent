import { test } from "node:test";
import assert from "node:assert/strict";
import { Conversation } from "@voxagent/agent-core";
import { createScriptedAgent } from "./mock.js";

test("chat: cập nhật lịch sử (user + assistant)", async () => {
  const agent = createScriptedAgent(["Chào ", "bạn!"]);
  const conv = new Conversation();
  const r = await agent.chat(conv, "xin chào");
  assert.equal(r.text, "Chào bạn!");
  assert.deepEqual(
    conv.messages().map((m) => `${m.role}:${m.content}`),
    ["user:xin chào", "assistant:Chào bạn!"],
  );
});

test("chatStream: ghi câu trả lời đầy đủ vào lịch sử khi xong", async () => {
  const agent = createScriptedAgent(["A", "B", "C"], { deltaDelayMs: 1 });
  const conv = new Conversation();
  let streamed = "";
  for await (const d of agent.chatStream(conv, "hỏi")) streamed += d;
  assert.equal(streamed, "ABC");
  assert.equal(conv.messages().at(-1)?.content, "ABC");
});

test("chatStream: bị abort thì KHÔNG ghi assistant vào lịch sử", async () => {
  const agent = createScriptedAgent(["A", "B", "C", "D"], { deltaDelayMs: 20 });
  const conv = new Conversation();
  const ctrl = new AbortController();
  const gen = agent.chatStream(conv, "hỏi", { signal: ctrl.signal });
  await gen.next();
  ctrl.abort();
  try {
    for await (const _ of gen) void _;
  } catch {
    /* aborted */
  }
  // chỉ có message user, chưa có assistant hoàn chỉnh
  assert.equal(conv.messages().filter((m) => m.role === "assistant").length, 0);
});
