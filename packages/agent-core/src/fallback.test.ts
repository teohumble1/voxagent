import { test } from "node:test";
import assert from "node:assert/strict";
import { withFallback, streamWithFallback, AllProvidersFailedError } from "./fallback.js";

test("withFallback: provider đầu lỗi -> chuyển provider sau", async () => {
  const tried: string[] = [];
  const { value, provider } = await withFallback(["anthropic", "openai"], async (_m, p) => {
    tried.push(p);
    if (p === "anthropic") throw new Error("rate limit giả");
    return "ok";
  });
  assert.deepEqual(tried, ["anthropic", "openai"]);
  assert.equal(value, "ok");
  assert.equal(provider, "openai");
});

test("withFallback: mọi provider lỗi -> AllProvidersFailedError", async () => {
  await assert.rejects(
    withFallback(["anthropic", "openai"], async () => {
      throw new Error("die");
    }),
    AllProvidersFailedError,
  );
});

test("streamWithFallback: lỗi trước token đầu -> fallback", async () => {
  const chunks: string[] = [];
  const gen = streamWithFallback(["anthropic", "openai"], (_m, p) => ({
    textStream: (async function* () {
      if (p === "anthropic") throw new Error("lỗi sớm");
      yield "xin ";
      yield "chào";
    })(),
  }));
  let next = await gen.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await gen.next();
  }
  assert.equal(chunks.join(""), "xin chào");
  assert.equal(next.value, "openai");
});

test("streamWithFallback: đã phát token thì KHÔNG fallback, ném lỗi", async () => {
  const chunks: string[] = [];
  await assert.rejects(async () => {
    const gen = streamWithFallback(["anthropic", "openai"], (_m, p) => ({
      textStream: (async function* () {
        yield "một phần...";
        if (p === "anthropic") throw new Error("đứt giữa chừng");
      })(),
    }));
    for await (const c of gen) chunks.push(c);
  });
  assert.equal(chunks.join(""), "một phần...");
});
