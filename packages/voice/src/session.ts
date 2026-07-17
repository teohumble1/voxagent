import type { Agent } from "@voxagent/agent-core";
import { SentenceChunker } from "./chunk.js";
import type { AudioChunk, TtsProvider, VoiceEvent, VoiceState } from "./types.js";

export interface VoiceSessionOptions {
  agent: Agent;
  tts: TtsProvider;
  onEvent?: (event: VoiceEvent) => void;
  /**
   * Thời gian im lặng (ms) coi là kết thúc lượt nói. Chỉ dùng khi bạn để session
   * tự chốt lượt bằng VAD; nếu tầng STT đã báo end-of-turn thì gọi endTurn() thẳng.
   */
  silenceMs?: number;
}

/**
 * Máy trạng thái điều phối một phiên thoại real-time:
 *
 *   idle → listening → thinking → speaking → listening ...
 *
 * - Turn-taking: khi người dùng ngừng nói (endTurn), agent xử lý rồi TTS phát lời.
 * - Barge-in: nếu người dùng nói chen vào lúc agent đang nghĩ/đang nói, huỷ ngay
 *   agent + TTS và quay lại lắng nghe.
 * - Đo latency: thời gian từ lúc chốt lượt tới lúc có audio TTS đầu tiên.
 *
 * Tầng transport (WebRTC/WebSocket) + STT/VAD chỉ cần gọi các method input:
 *   speechStart(), transcript(), endTurn().
 */
export class VoiceSession {
  private _state: VoiceState = "idle";
  private pendingTranscript = "";
  private turnStartedAt = 0;
  private abort: AbortController | null = null;
  private turnSeq = 0;

  constructor(private readonly opts: VoiceSessionOptions) {}

  get state(): VoiceState {
    return this._state;
  }

  private emit(event: VoiceEvent): void {
    this.opts.onEvent?.(event);
  }

  private setState(state: VoiceState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit({ type: "state", state });
  }

  start(): void {
    this.setState("listening");
  }

  /** Người dùng bắt đầu nói. Nếu agent đang nghĩ/nói → barge-in. */
  speechStart(): void {
    if (this._state === "thinking" || this._state === "speaking") {
      this.bargeIn();
    }
  }

  /** Cập nhật transcript từ STT (partial hoặc final). */
  transcript(text: string, isFinal: boolean): void {
    if (isFinal) {
      this.pendingTranscript = text;
      this.emit({ type: "final-transcript", text });
    } else {
      this.emit({ type: "partial-transcript", text });
    }
  }

  /**
   * Người dùng ngừng nói (kết thúc lượt). Chốt transcript và cho agent xử lý.
   */
  endTurn(): void {
    const prompt = this.pendingTranscript.trim();
    this.pendingTranscript = "";
    if (!prompt) {
      this.setState("listening");
      return;
    }
    this.turnStartedAt = Date.now();
    void this.runAgentTurn(prompt);
  }

  private bargeIn(): void {
    this.abort?.abort();
    this.abort = null;
    this.turnSeq++; // vô hiệu hoá lượt đang chạy
    this.emit({ type: "barge-in" });
    this.setState("listening");
  }

  private async runAgentTurn(prompt: string): Promise<void> {
    const seq = ++this.turnSeq;
    const controller = new AbortController();
    this.abort = controller;
    this.setState("thinking");

    const chunker = new SentenceChunker();
    let firstAudioSent = false;

    const speak = async (sentence: string): Promise<void> => {
      if (seq !== this.turnSeq || controller.signal.aborted) return;
      await this.opts.tts.synthesize(
        sentence,
        (chunk: AudioChunk) => {
          if (seq !== this.turnSeq) return;
          if (!firstAudioSent) {
            firstAudioSent = true;
            this.emit({ type: "turn-latency", ms: Date.now() - this.turnStartedAt });
            this.setState("speaking");
          }
          this.emit({ type: "tts-audio", chunk });
        },
        controller.signal,
      );
    };

    try {
      const stream = this.opts.agent.stream(prompt, { signal: controller.signal });
      let next = await stream.next();
      while (!next.done) {
        if (seq !== this.turnSeq) return; // đã bị barge-in
        const delta = next.value;
        this.emit({ type: "agent-text", delta });
        for (const sentence of chunker.push(delta)) {
          await speak(sentence);
        }
        next = await stream.next();
      }
      const tail = chunker.flush();
      if (tail) await speak(tail);

      if (seq === this.turnSeq) {
        this.abort = null;
        this.emit({ type: "turn-complete" });
        this.setState("listening");
      }
    } catch (err) {
      if (controller.signal.aborted) return; // barge-in: im lặng bỏ qua
      this.emit({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
      if (seq === this.turnSeq) this.setState("listening");
    }
  }
}
