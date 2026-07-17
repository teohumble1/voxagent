import {
  generateText,
  generateObject,
  streamText,
  stepCountIs,
  type ToolSet,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { availableProviders, type ProviderName } from "./provider.js";
import { withFallback, streamWithFallback } from "./fallback.js";
import { defaultTools } from "./tools.js";
import { Conversation } from "./conversation.js";
import {
  inspectInput,
  sanitizeOutput,
  guardTools,
  GuardBlockedError,
  type GuardPolicy,
} from "./guard.js";
import { telemetryEnabled } from "./telemetry.js";
import { cacheKey, type ResponseCache } from "./cache.js";

const DEFAULT_SYSTEM =
  "Bạn là trợ lý tiếng Việt gọn gàng, chính xác. " +
  "Khi cần dữ liệu thời gian thực hoặc tính toán, hãy dùng tool thay vì đoán.";

export interface AgentConfig {
  name: string;
  system?: string;
  tools?: ToolSet;
  provider?: ProviderName;
  maxSteps?: number;
  /** Bật prompt-injection defense: soi input, allowlist tool, lọc output. */
  guard?: GuardPolicy;
  /** Cache phản hồi (opt-in). Chỉ dùng cho prompt idempotent. */
  cache?: ResponseCache;
}

export interface RunAgentResult {
  text: string;
  provider: ProviderName;
  steps: number;
  toolCalls: string[];
  /** true nếu kết quả lấy từ cache. */
  cached?: boolean;
}

export interface StreamOptions {
  /** Ngắt giữa chừng (dùng cho barge-in trong voice). */
  signal?: AbortSignal;
}

export interface Agent {
  readonly name: string;
  generate(prompt: string): Promise<RunAgentResult>;
  stream(
    prompt: string,
    options?: StreamOptions,
  ): AsyncGenerator<string, ProviderName, void>;
  /** Trả lời có ngữ cảnh: dùng toàn bộ lịch sử trong `conversation` và tự cập nhật nó. */
  chat(conversation: Conversation, userText: string): Promise<RunAgentResult>;
  /** Bản streaming của chat; câu trả lời đầy đủ được ghi vào conversation khi xong. */
  chatStream(
    conversation: Conversation,
    userText: string,
    options?: StreamOptions,
  ): AsyncGenerator<string, ProviderName, void>;
}

export function defineAgent(config: AgentConfig): Agent {
  const system = config.system ?? DEFAULT_SYSTEM;
  const guard = config.guard;
  const rawTools = config.tools ?? defaultTools;
  const tools = guard
    ? guardTools(rawTools, guard, (name) =>
        console.error(`  🛡️  tool bị từ chối: ${name}`),
      )
    : rawTools;
  const stop = stepCountIs(config.maxSteps ?? 5);
  const order = (): ProviderName[] => availableProviders(config.provider);
  const telemetry = { isEnabled: telemetryEnabled(), functionId: config.name };

  function checkInput(prompt: string): void {
    if (!guard) return;
    const verdict = inspectInput(prompt, guard);
    if (verdict.matches.length > 0) {
      console.error(
        `  🛡️  input risk=${verdict.risk} (${verdict.matches.join(", ")}) allowed=${verdict.allowed}`,
      );
    }
    if (!verdict.allowed) throw new GuardBlockedError(verdict);
  }

  // Lõi non-stream dùng chung cho generate() và chat(): chạy trên MẢNG messages.
  async function runMessages(messages: ModelMessage[]): Promise<RunAgentResult> {
    const { value, provider } = await withFallback(order(), (model) =>
      generateText({
        model,
        system,
        messages,
        tools,
        stopWhen: stop,
        experimental_telemetry: telemetry,
      }),
    );
    const toolCalls = value.steps.flatMap((step) =>
      step.toolCalls.map((call) => call.toolName),
    );
    const safe = guard ? sanitizeOutput(value.text, system, guard).text : value.text;
    return { text: safe, provider, steps: value.steps.length, toolCalls };
  }

  function streamMessages(
    messages: ModelMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string, ProviderName, void> {
    return streamWithFallback(order(), (model) =>
      streamText({
        model,
        system,
        messages,
        tools,
        stopWhen: stop,
        abortSignal: signal,
        experimental_telemetry: telemetry,
      }),
    );
  }

  return {
    name: config.name,

    async generate(prompt: string): Promise<RunAgentResult> {
      checkInput(prompt);

      const key = config.cache
        ? cacheKey({ system, prompt, toolNames: Object.keys(tools) })
        : null;
      if (key && config.cache) {
        const hit = await config.cache.get(key);
        if (hit) return { ...hit, cached: true };
      }

      const result = await runMessages([{ role: "user", content: prompt }]);
      if (key && config.cache) await config.cache.set(key, result);
      return result;
    },

    stream(
      prompt: string,
      options?: StreamOptions,
    ): AsyncGenerator<string, ProviderName, void> {
      checkInput(prompt);
      return streamMessages([{ role: "user", content: prompt }], options?.signal);
    },

    async chat(conversation: Conversation, userText: string): Promise<RunAgentResult> {
      checkInput(userText);
      conversation.add("user", userText);
      const result = await runMessages(conversation.toModelMessages());
      conversation.add("assistant", result.text);
      return result;
    },

    async *chatStream(
      conversation: Conversation,
      userText: string,
      options?: StreamOptions,
    ): AsyncGenerator<string, ProviderName, void> {
      checkInput(userText);
      conversation.add("user", userText);
      let full = "";
      const gen = streamMessages(conversation.toModelMessages(), options?.signal);
      let next = await gen.next();
      while (!next.done) {
        full += next.value;
        yield next.value;
        next = await gen.next();
      }
      // chỉ ghi câu trả lời vào lịch sử nếu hoàn tất (không bị abort giữa chừng)
      if (!options?.signal?.aborted) conversation.add("assistant", full);
      return next.value;
    },
  };
}

const defaultAgent = defineAgent({ name: "default" });

export interface RunAgentOptions {
  prompt: string;
  system?: string;
  provider?: ProviderName;
  tools?: ToolSet;
  maxSteps?: number;
  guard?: GuardPolicy;
}

export async function runAgent(
  options: RunAgentOptions,
): Promise<RunAgentResult> {
  const custom =
    options.system ||
    options.tools ||
    options.provider ||
    options.maxSteps ||
    options.guard;
  const agent = custom
    ? defineAgent({
        name: "adhoc",
        system: options.system,
        tools: options.tools,
        provider: options.provider,
        maxSteps: options.maxSteps,
        guard: options.guard,
      })
    : defaultAgent;
  return agent.generate(options.prompt);
}

export async function extractStructured<T extends z.ZodTypeAny>(
  prompt: string,
  schema: T,
  provider?: ProviderName,
): Promise<z.infer<T>> {
  const { value } = await withFallback(availableProviders(provider), (model) =>
    generateObject({ model, schema, prompt }),
  );
  return value.object;
}
