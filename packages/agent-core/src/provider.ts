import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderName = "anthropic" | "openai";

export const ALL_PROVIDERS: readonly ProviderName[] = ["anthropic", "openai"];

/**
 * Model mặc định cho mỗi provider. Đổi ở đây hoặc qua env.
 */
const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  openai: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};

export function hasKey(provider: ProviderName): boolean {
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  return Boolean(process.env.OPENAI_API_KEY);
}

export function buildModel(provider: ProviderName): LanguageModel {
  const model = DEFAULT_MODEL[provider];
  return provider === "anthropic" ? anthropic(model) : openai(model);
}

/**
 * Danh sách provider để thử theo thứ tự: provider ưu tiên trước, rồi tới
 * các provider còn lại — nhưng chỉ giữ những provider đã có API key.
 * Dùng cho cả fallback-khi-thiếu-key lẫn fallback-khi-model-lỗi-runtime.
 */
export function availableProviders(preferred?: ProviderName): ProviderName[] {
  const first =
    preferred ?? (process.env.VOXAGENT_PROVIDER as ProviderName) ?? "anthropic";
  const ordered: ProviderName[] = [
    first,
    ...ALL_PROVIDERS.filter((p) => p !== first),
  ];
  const usable = ordered.filter(hasKey);

  if (usable.length === 0) {
    throw new Error(
      "Chưa có API key nào. Hãy điền ANTHROPIC_API_KEY hoặc OPENAI_API_KEY vào file .env",
    );
  }
  return usable;
}

/** Giữ lại cho tương thích: chọn model đầu tiên khả dụng. */
export function selectModel(preferred?: ProviderName): {
  model: LanguageModel;
  provider: ProviderName;
} {
  const provider = availableProviders(preferred)[0]!;
  return { model: buildModel(provider), provider };
}
