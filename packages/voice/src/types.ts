/**
 * Khối byte audio thô (thường là PCM 16-bit). Nội dung để mờ (opaque) — package
 * này không giải mã audio, chỉ điều phối luồng và thời điểm.
 */
export interface AudioChunk {
  data: Uint8Array;
}

export interface Transcript {
  text: string;
  /** true = câu đã chốt (end of utterance), false = bản nháp đang cập nhật. */
  isFinal: boolean;
}

/**
 * Speech-to-Text streaming. Provider thật (Deepgram, OpenAI Realtime, Whisper...)
 * implement interface này; test dùng bản mock.
 */
export interface SttProvider {
  start(onTranscript: (t: Transcript) => void): void;
  pushAudio(chunk: AudioChunk): void;
  stop(): void;
}

/**
 * Text-to-Speech streaming, hỗ trợ HUỶ giữa chừng (bắt buộc cho barge-in).
 * Provider thật: ElevenLabs, Cartesia, OpenAI TTS...
 */
export interface TtsProvider {
  synthesize(
    text: string,
    onAudio: (chunk: AudioChunk) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

/** Phát hiện có tiếng nói hay im lặng trong một khung audio (VAD). */
export interface VadDetector {
  process(chunk: AudioChunk): "speech" | "silence";
}

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

export type VoiceEvent =
  | { type: "state"; state: VoiceState }
  | { type: "partial-transcript"; text: string }
  | { type: "final-transcript"; text: string }
  | { type: "agent-text"; delta: string }
  | { type: "tts-audio"; chunk: AudioChunk }
  | { type: "barge-in" }
  | { type: "turn-latency"; ms: number }
  | { type: "turn-complete" }
  | { type: "error"; message: string };
