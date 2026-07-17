import { createHash } from "node:crypto";
import type { RunAgentResult } from "./agent.js";

/**
 * Interface cache BẤT ĐỒNG BỘ — để bản in-memory lẫn Redis đều implement được
 * (Redis vốn là async qua mạng).
 */
export interface ResponseCache {
  get(key: string): Promise<RunAgentResult | undefined>;
  set(key: string, value: RunAgentResult): Promise<void>;
}

/**
 * Key cache từ những thứ ảnh hưởng kết quả: system + prompt + danh sách tool.
 */
export function cacheKey(parts: {
  system: string;
  prompt: string;
  toolNames: string[];
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...parts, toolNames: [...parts.toolNames].sort() }))
    .digest("hex");
}

/**
 * Cache LRU trong bộ nhớ, giới hạn số phần tử. Chỉ bật cho prompt idempotent.
 * Thay bằng RedisCache khi chạy nhiều node.
 */
export class MemoryCache implements ResponseCache {
  private store = new Map<string, RunAgentResult>();

  constructor(private readonly maxEntries = 500) {}

  async get(key: string): Promise<RunAgentResult | undefined> {
    const hit = this.store.get(key);
    if (hit) {
      this.store.delete(key);
      this.store.set(key, hit);
    }
    return hit;
  }

  async set(key: string, value: RunAgentResult): Promise<void> {
    this.store.delete(key);
    this.store.set(key, value);
    if (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }
}

/**
 * Client Redis tối giản mà RedisCache cần — tương thích ioredis và node-redis
 * (chỉ dùng get + set với TTL). Không khoá cứng vào một thư viện nào.
 */
export interface MinimalRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
}

/**
 * Cache dùng Redis: chia sẻ được giữa nhiều node, có TTL. Truyền client vào
 * (vd `new Redis(process.env.REDIS_URL)` của ioredis) — package này không tự
 * require ioredis để giữ dependency nhẹ và tránh khoá công nghệ.
 */
export class RedisCache implements ResponseCache {
  constructor(
    private readonly redis: MinimalRedis,
    private readonly ttlSeconds = 3600,
    private readonly prefix = "voxagent:cache:",
  ) {}

  async get(key: string): Promise<RunAgentResult | undefined> {
    const raw = await this.redis.get(this.prefix + key);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as RunAgentResult;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: RunAgentResult): Promise<void> {
    await this.redis.set(this.prefix + key, JSON.stringify(value), "EX", this.ttlSeconds);
  }
}
