import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import type { AddressInfo } from "node:net";
import { createVoiceGateway } from "./gateway.js";
import { MockTts, MockStt, createScriptedAgent } from "./mock.js";

test("VoiceGateway: client gửi audio + speech_end -> nhận state + tts-audio + done", async () => {
  const agent = createScriptedAgent(["Xin ", "chào bạn."], { deltaDelayMs: 2 });
  const wss = createVoiceGateway({
    agent,
    createStt: () => new MockStt("mấy giờ rồi"),
    tts: new MockTts(2),
    port: 0, // cổng ngẫu nhiên
    path: "/voice",
  });

  await new Promise<void>((resolve) => wss.on("listening", resolve));
  const port = (wss.address() as AddressInfo).port;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/voice`);
  const jsonEvents: { type: string }[] = [];
  let audioFrames = 0;

  const done = new Promise<void>((resolve, reject) => {
    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        audioFrames++;
        return;
      }
      const ev = JSON.parse(data.toString()) as { type: string };
      jsonEvents.push(ev);
      if (ev.type === "turn-complete") resolve();
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 3000);
  });

  await new Promise<void>((resolve) => ws.on("open", resolve));
  ws.send(Buffer.from([1, 2, 3])); // audio frame -> MockStt phát transcript final
  ws.send(JSON.stringify({ type: "speech_end" })); // chốt lượt

  await done;
  ws.close();
  await new Promise<void>((resolve) => wss.close(() => resolve()));

  const types = jsonEvents.map((e) => e.type);
  assert.ok(types.includes("final-transcript"), "có final-transcript");
  assert.ok(types.includes("turn-latency"), "có đo latency");
  assert.ok(audioFrames > 0, "nhận được audio TTS (binary)");
  assert.ok(types.includes("turn-complete"), "kết thúc lượt");
});
