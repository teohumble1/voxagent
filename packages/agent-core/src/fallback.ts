import type { LanguageModel } from "ai";
import { buildModel, type ProviderName } from "./provider.js";

export class AllProvidersFailedError extends Error {
  constructor(public readonly failures: Record<ProviderName | string, string>) {
    const detail = Object.entries(failures)
      .map(([p, msg]) => `  - ${p}: ${msg}`)
      .join("\n");
    super(`Tất cả provider đều lỗi:\n${detail}`);
    this.name = "AllProvidersFailedError";
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Chạy `run` lần lượt trên từng provider cho tới khi một provider thành công.
 * Dùng cho lời gọi non-streaming (generateText/generateObject): nếu provider
 * ưu tiên lỗi (rate limit, 5xx, model down...) thì tự chuyển sang provider sau.
 */
export async function withFallback<T>(
  order: ProviderName[],
  run: (model: LanguageModel, provider: ProviderName) => Promise<T>,
): Promise<{ value: T; provider: ProviderName }> {
  const failures: Record<string, string> = {};
  for (const provider of order) {
    try {
      const value = await run(buildModel(provider), provider);
      return { value, provider };
    } catch (err) {
      failures[provider] = message(err);
    }
  }
  throw new AllProvidersFailedError(failures);
}

export interface StreamHandle {
  textStream: AsyncIterable<string>;
}

/**
 * Bản streaming của fallback: chỉ chuyển provider khi lỗi xảy ra TRƯỚC khi
 * phát ra token đầu tiên. Đã phát token thì không thể phát lại an toàn nên ném lỗi.
 */
export async function* streamWithFallback(
  order: ProviderName[],
  start: (model: LanguageModel, provider: ProviderName) => StreamHandle,
): AsyncGenerator<string, ProviderName, void> {
  const failures: Record<string, string> = {};
  for (const provider of order) {
    let emitted = false;
    try {
      const handle = start(buildModel(provider), provider);
      for await (const chunk of handle.textStream) {
        emitted = true;
        yield chunk;
      }
      return provider;
    } catch (err) {
      failures[provider] = message(err);
      if (emitted) throw err;
    }
  }
  throw new AllProvidersFailedError(failures);
}
