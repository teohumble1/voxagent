import { anthropic } from "@ai-sdk/anthropic";
import { openai, createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type ProviderName = "anthropic" | "openai" | "ollama";

export const ALL_PROVIDERS: readonly ProviderName[] = ["anthropic", "openai", "ollama"];

/**
 * Model mặc định cho mỗi provider. Đổi ở đây hoặc qua env.
 * ollama = LLM local (free, không key, dữ liệu không rời máy) qua endpoint
 * OpenAI-compatible của Ollama.
 */
const DEFAULT_MODEL: Record<ProviderName, string> = {
  anthropic: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  openai: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  ollama: process.env.OLLAMA_MODEL ?? "qwen2.5:7b",
};

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";

// Provider Ollama: dùng lớp OpenAI-compatible, apiKey chỉ là placeholder.
const ollamaProvider = createOpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: "ollama" });

export function hasKey(provider: ProviderName): boolean {
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  // ollama coi như "khả dụng" khi người dùng chủ động chọn nó (không cần key).
  return (
    process.env.VOXAGENT_PROVIDER === "ollama" ||
    Boolean(process.env.OLLAMA_BASE_URL) ||
    Boolean(process.env.OLLAMA_MODEL)
  );
}

export function buildModel(provider: ProviderName): LanguageModel {
  const model = DEFAULT_MODEL[provider];
  if (provider === "anthropic") return anthropic(model);
  if (provider === "openai") return openai(model);
  // .chat() ép dùng Chat Completions API — Ollama không hỗ trợ Responses API.
  return ollamaProvider.chat(model);
}

/**
 * Danh sách provider để thử theo thứ tự: provider ưu tiên trước, rồi tới
 * các provider còn lại — nhưng chỉ giữ những provider khả dụng (có key, hoặc
 * ollama được bật).
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
      "Chưa có provider nào khả dụng. Điền ANTHROPIC_API_KEY / OPENAI_API_KEY, " +
        "hoặc đặt VOXAGENT_PROVIDER=ollama để dùng LLM local.",
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
