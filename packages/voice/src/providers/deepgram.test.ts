import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDeepgram } from "./deepgram.js";

test("parseDeepgram: transcript partial", () => {
  const raw = JSON.stringify({
    type: "Results",
    is_final: false,
    channel: { alternatives: [{ transcript: "mấy giờ" }] },
  });
  assert.deepEqual(parseDeepgram(raw), { text: "mấy giờ", isFinal: false });
});

test("parseDeepgram: transcript final", () => {
  const raw = JSON.stringify({
    type: "Results",
    is_final: true,
    channel: { alternatives: [{ transcript: "mấy giờ rồi" }] },
  });
  assert.deepEqual(parseDeepgram(raw), { text: "mấy giờ rồi", isFinal: true });
});

test("parseDeepgram: transcript rỗng -> null", () => {
  const raw = JSON.stringify({ type: "Results", is_final: true, channel: { alternatives: [{ transcript: "" }] } });
  assert.equal(parseDeepgram(raw), null);
});

test("parseDeepgram: message loại khác (Metadata) -> null", () => {
  assert.equal(parseDeepgram(JSON.stringify({ type: "Metadata" })), null);
});

test("parseDeepgram: JSON hỏng -> null (không ném)", () => {
  assert.equal(parseDeepgram("{không phải json"), null);
});
