import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache, RedisCache, cacheKey, type MinimalRedis } from "./cache.js";
import type { RunAgentResult } from "./agent.js";

const sample: RunAgentResult = { text: "hi", provider: "anthropic", steps: 1, toolCalls: [] };

test("cacheKey ổn định bất kể thứ tự tool", () => {
  const a = cacheKey({ system: "s", prompt: "p", toolNames: ["b", "a"] });
  const b = cacheKey({ system: "s", prompt: "p", toolNames: ["a", "b"] });
  assert.equal(a, b);
});

test("MemoryCache: miss rồi hit", async () => {
  const cache = new MemoryCache(2);
  const k = cacheKey({ system: "s", prompt: "p", toolNames: [] });
  assert.equal(await cache.get(k), undefined);
  await cache.set(k, sample);
  assert.equal((await cache.get(k))?.text, "hi");
});

test("MemoryCache: LRU đẩy phần tử ít dùng nhất", async () => {
  const cache = new MemoryCache(2);
  await cache.set("a", sample);
  await cache.set("b", sample);
  await cache.get("a");
  await cache.set("c", sample);
  assert.equal(await cache.get("b"), undefined);
  assert.equal((await cache.get("a"))?.text, "hi");
});

// Fake Redis client (Map) — kiểm tra RedisCache serialize/deserialize + TTL đúng.
class FakeRedis implements MinimalRedis {
  store = new Map<string, string>();
  lastTtl = 0;
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async set(key: string, value: string, _mode: "EX", ttl: number): Promise<unknown> {
    this.store.set(key, value);
    this.lastTtl = ttl;
    return "OK";
  }
}

test("RedisCache: set rồi get trả đúng object; áp TTL", async () => {
  const redis = new FakeRedis();
  const cache = new RedisCache(redis, 1800);
  assert.equal(await cache.get("k"), undefined);
  await cache.set("k", sample);
  assert.equal(redis.lastTtl, 1800);
  assert.ok([...redis.store.keys()][0]?.startsWith("voxagent:cache:"));
  const hit = await cache.get("k");
  assert.deepEqual(hit, sample);
});

test("RedisCache: giá trị hỏng -> undefined (không ném)", async () => {
  const redis = new FakeRedis();
  redis.store.set("voxagent:cache:bad", "{không phải json");
  const cache = new RedisCache(redis);
  assert.equal(await cache.get("bad"), undefined);
});
