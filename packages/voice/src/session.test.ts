import { test } from "node:test";
import assert from "node:assert/strict";
import { VoiceSession } from "./session.js";
import { MockTts, createScriptedAgent } from "./mock.js";
import type { VoiceEvent } from "./types.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const types = (e: VoiceEvent[]): string[] => e.map((x) => x.type);

test("VoiceSession: lượt bình thường -> TTS + latency + về listening", async () => {
  const events: VoiceEvent[] = [];
  const agent = createScriptedAgent(["Bây giờ ", "là 10 giờ. ", "Chúc vui!"], { deltaDelayMs: 3 });
  const session = new VoiceSession({ agent, tts: new MockTts(2), onEvent: (e) => events.push(e) });
  session.start();
  assert.equal(session.state, "listening");

  session.transcript("mấy giờ rồi", true);
  session.endTurn();
  await sleep(200);

  assert.ok(types(events).includes("tts-audio"));
  assert.ok(events.some((e) => e.type === "state" && e.state === "thinking"));
  assert.ok(events.some((e) => e.type === "state" && e.state === "speaking"));
  assert.equal(session.state, "listening");

  const lat = events.find((e) => e.type === "turn-latency");
  assert.ok(lat?.type === "turn-latency" && lat.ms < 1000);
});

test("VoiceSession: barge-in -> dừng audio, về listening", async () => {
  const events: VoiceEvent[] = [];
  const agent = createScriptedAgent(
    ["Đây là ", "một câu ", "rất ", "rất dài ", "để bị cắt."],
    { deltaDelayMs: 15 },
  );
  const session = new VoiceSession({ agent, tts: new MockTts(10), onEvent: (e) => events.push(e) });
  session.start();
  session.transcript("kể chuyện dài", true);
  session.endTurn();
  await sleep(60);

  const before = types(events).filter((t) => t === "tts-audio").length;
  session.speechStart(); // barge-in
  assert.equal(session.state, "listening");
  await sleep(200);
  const after = types(events).filter((t) => t === "tts-audio").length;

  assert.ok(types(events).includes("barge-in"));
  assert.equal(after, before, "không phát thêm audio của lượt cũ");
  assert.equal(session.state, "listening");
});
