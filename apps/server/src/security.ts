import { timingSafeEqual } from "node:crypto";

/**
 * So sánh token an toàn trước timing attack (thời gian không phụ thuộc nội dung).
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Kiểm tra Authorization: Bearer <token>. Nếu KHÔNG cấu hình token (env rỗng) thì
 * coi như chế độ dev — cho qua nhưng nên bật token khi chạy thật.
 */
export function checkAuth(authHeader: string | undefined, expected: string | undefined): boolean {
  if (!expected) return true; // dev mode
  if (!authHeader?.startsWith("Bearer ")) return false;
  return safeEqual(authHeader.slice(7).trim(), expected);
}

/**
 * Rate limiter cửa sổ cố định theo khoá (IP). Đơn giản, không cần Redis cho 1 node;
 * scale nhiều node thì thay bằng Redis INCR + EXPIRE.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 30,
    private readonly windowMs = 60_000,
  ) {}

  /** true nếu ĐƯỢC phép; false nếu vượt hạn mức. */
  allow(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || now > entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count++;
    return true;
  }

  /** Dọn định kỳ các khoá đã hết hạn để không rò bộ nhớ. */
  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.hits) {
      if (now > entry.resetAt) this.hits.delete(key);
    }
  }
}
