import { test } from "node:test";
import assert from "node:assert/strict";
import { pcm16ToWav } from "./whisper.js";
import { resamplePcm16 } from "./piper.js";

test("pcm16ToWav: header WAV đúng chuẩn 16k mono 16-bit", () => {
  const pcm = new Uint8Array([1, 2, 3, 4]);
  const wav = pcm16ToWav(pcm, 16000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(v.getUint32(24, true), 16000); // sample rate
  assert.equal(v.getUint16(22, true), 1); // mono
  assert.equal(v.getUint16(34, true), 16); // bits
  assert.equal(v.getUint32(40, true), 4); // data size
  assert.equal(wav.length, 44 + 4);
  assert.deepEqual([...wav.slice(44)], [1, 2, 3, 4]);
});

test("resamplePcm16: cùng rate -> trả nguyên vẹn", () => {
  const input = new Int16Array([1, 2, 3]);
  assert.equal(resamplePcm16(input, 16000, 16000), input);
});

test("resamplePcm16: 22050 -> 16000 đúng độ dài và biên độ", () => {
  const input = new Int16Array(22050).fill(1000); // 1 giây tín hiệu phẳng
  const out = resamplePcm16(input, 22050, 16000);
  assert.equal(out.length, 16000); // đúng 1 giây ở rate mới
  // Tín hiệu phẳng thì nội suy tuyến tính không được làm méo giá trị.
  assert.ok([...out].every((s) => s === 1000));
});

test("resamplePcm16: nội suy tuyến tính giữa 2 mẫu", () => {
  const out = resamplePcm16(new Int16Array([0, 100]), 1000, 2000);
  assert.equal(out.length, 4);
  assert.equal(out[0], 0);
  assert.equal(out[1], 50); // điểm giữa
});
