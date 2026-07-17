import type { Agent, Conversation, ProviderName } from "@voxagent/agent-core";
import type { AudioChunk, SttProvider, Transcript, TtsProvider } from "./types.js";

/**
 * STT giả: mỗi khung audio nhận được sẽ phát ra một transcript "final" đã định sẵn.
 * Dùng để test gateway/pipeline mà không cần Deepgram hay mic thật.
 */
export class MockStt implements SttProvider {
  private cb: ((t: Transcript) => void) | null = null;
  constructor(private readonly scriptedFinal = "xin chào") {}
  start(onTranscript: (t: Transcript) => void): void {
    this.cb = onTranscript;
  }
  pushAudio(_chunk: AudioChunk): void {
    this.cb?.({ text: this.scriptedFinal, isFinal: true });
  }
  stop(): void {
    this.cb = null;
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * TTS giả: cắt text thành khung nhỏ, phát mỗi khung sau một khoảng trễ, và TÔN
 * TRỌNG abort (dừng ngay khi barge-in). Byte audio chỉ là placeholder.
 */
export class MockTts implements TtsProvider {
  constructor(private readonly frameDelayMs = 5) {}

  async synthesize(
    text: string,
    onAudio: (chunk: AudioChunk) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const frames = Math.max(1, Math.ceil(text.length / 8));
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) return;
      await sleep(this.frameDelayMs);
      if (signal.aborted) return;
      onAudio({ data: new Uint8Array([i & 0xff]) });
    }
  }
}

/**
 * Agent giả cho test: stream sẵn một chuỗi delta với độ trễ nhỏ, tôn trọng signal.
 * Không gọi mạng, không cần API key.
 */
export function createScriptedAgent(
  deltas: string[],
  opts: { deltaDelayMs?: number; provider?: ProviderName } = {},
): Agent {
  const delay = opts.deltaDelayMs ?? 5;
  const provider = opts.provider ?? "anthropic";
  async function* streamDeltas(signal?: AbortSignal): AsyncGenerator<string, ProviderName, void> {
    for (const d of deltas) {
      if (signal?.aborted) throw new Error("aborted");
      await sleep(delay);
      if (signal?.aborted) throw new Error("aborted");
      yield d;
    }
    return provider;
  }

  return {
    name: "scripted",
    async generate() {
      return { text: deltas.join(""), provider, steps: 1, toolCalls: [] };
    },
    stream(_prompt: string, options?: { signal?: AbortSignal }) {
      return streamDeltas(options?.signal);
    },
    async chat(conversation: Conversation, userText: string) {
      conversation.add("user", userText);
      const text = deltas.join("");
      conversation.add("assistant", text);
      return { text, provider, steps: 1, toolCalls: [] };
    },
    async *chatStream(conversation: Conversation, userText: string, options?: { signal?: AbortSignal }) {
      conversation.add("user", userText);
      let full = "";
      const gen = streamDeltas(options?.signal);
      let next = await gen.next();
      while (!next.done) {
        full += next.value;
        yield next.value;
        next = await gen.next();
      }
      if (!options?.signal?.aborted) conversation.add("assistant", full);
      return next.value;
    },
  };
}
