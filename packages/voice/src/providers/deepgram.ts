import WebSocket from "ws";
import type { AudioChunk, SttProvider, Transcript } from "../types.js";

/**
 * Bóc transcript từ một message JSON của Deepgram streaming. Tách riêng thành hàm
 * thuần để test được mà không cần mạng.
 */
export function parseDeepgram(raw: string): Transcript | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  const m = msg as {
    type?: string;
    is_final?: boolean;
    channel?: { alternatives?: { transcript?: string }[] };
  };
  if (m.type && m.type !== "Results") return null;
  const text = m.channel?.alternatives?.[0]?.transcript ?? "";
  if (!text) return null;
  return { text, isFinal: Boolean(m.is_final) };
}

export interface DeepgramOptions {
  model?: string;
  language?: string;
  sampleRate?: number;
  encoding?: string;
}

/**
 * STT streaming qua Deepgram. Cùng interface SttProvider với bản mock, nên cắm
 * vào pipeline y hệt. Key lấy từ tham số (đừng hardcode) — thường từ env DEEPGRAM_API_KEY.
 */
export class DeepgramStt implements SttProvider {
  private ws: WebSocket | null = null;
  private queue: Uint8Array[] = [];
  private onTranscript: ((t: Transcript) => void) | null = null;

  constructor(
    private readonly apiKey: string,
    private readonly opts: DeepgramOptions = {},
  ) {}

  start(onTranscript: (t: Transcript) => void): void {
    this.onTranscript = onTranscript;
    const params = new URLSearchParams({
      model: this.opts.model ?? "nova-2",
      language: this.opts.language ?? "vi",
      encoding: this.opts.encoding ?? "linear16",
      sample_rate: String(this.opts.sampleRate ?? 16000),
      interim_results: "true",
    });
    const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;
    this.ws = new WebSocket(url, { headers: { Authorization: `Token ${this.apiKey}` } });

    this.ws.on("open", () => {
      for (const buf of this.queue) this.ws?.send(buf);
      this.queue = [];
    });
    this.ws.on("message", (data: WebSocket.RawData) => {
      const t = parseDeepgram(data.toString());
      if (t && this.onTranscript) this.onTranscript(t);
    });
  }

  pushAudio(chunk: AudioChunk): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(chunk.data);
    else this.queue.push(chunk.data);
  }

  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "CloseStream" }));
    }
    this.ws?.close();
    this.ws = null;
  }
}
