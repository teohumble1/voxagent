import type { AudioChunk, TtsProvider } from "../types.js";

export interface ElevenLabsOptions {
  voiceId?: string;
  modelId?: string;
  /** Định dạng audio đầu ra, vd "pcm_16000" hợp cho phát real-time. */
  outputFormat?: string;
}

/**
 * TTS streaming qua ElevenLabs. POST text, đọc audio theo chunk từ ReadableStream
 * và TÔN TRỌNG AbortSignal (dừng ngay khi barge-in). Cùng interface TtsProvider.
 * Key từ tham số (env ELEVENLABS_API_KEY) — không hardcode.
 */
export class ElevenLabsTts implements TtsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly opts: ElevenLabsOptions = {},
  ) {}

  async synthesize(
    text: string,
    onAudio: (chunk: AudioChunk) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const voiceId = this.opts.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
    const format = this.opts.outputFormat ?? "pcm_16000";
    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream` +
      `?output_format=${encodeURIComponent(format)}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: this.opts.modelId ?? "eleven_flash_v2_5",
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`ElevenLabs TTS lỗi: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    for (;;) {
      if (signal.aborted) {
        await reader.cancel().catch(() => undefined);
        return;
      }
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length > 0) onAudio({ data: value });
    }
  }
}
