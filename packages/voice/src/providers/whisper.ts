import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioChunk, SttProvider, Transcript } from "../types.js";

export interface WhisperOptions {
  /** Đường dẫn whisper-cli (build từ whisper.cpp). */
  binPath: string;
  /** Đường dẫn model ggml (vd ggml-base.bin). */
  modelPath: string;
  language?: string;
  sampleRate?: number;
  threads?: number;
}

/** Đóng PCM16 mono thành file WAV (whisper-cli chỉ ăn file). Thuần để test. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  v.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits
  writeStr(36, "data");
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/**
 * STT local qua whisper.cpp — batch theo lượt nói, không cần mạng/API key.
 *
 * Khác Deepgram (streaming, tự đẩy transcript): whisper-cli chạy theo file,
 * nên provider này GOM audio lại và chỉ transcribe khi `flush()` được gọi
 * (gateway gọi lúc client báo speech_end, TRƯỚC session.endTurn()). Đổi lại:
 * không có partial transcript — chấp nhận được cho demo local.
 */
export class WhisperStt implements SttProvider {
  private buffers: Uint8Array[] = [];
  private onTranscript: ((t: Transcript) => void) | null = null;
  private busy = false;

  constructor(private readonly opts: WhisperOptions) {}

  start(onTranscript: (t: Transcript) => void): void {
    this.onTranscript = onTranscript;
  }

  pushAudio(chunk: AudioChunk): void {
    this.buffers.push(chunk.data);
  }

  /** Transcribe phần audio đã gom rồi phát final transcript. */
  async flush(): Promise<void> {
    if (this.busy) return; // một lượt đang chạy — bỏ qua flush chồng
    const total = this.buffers.reduce((n, b) => n + b.length, 0);
    const pcm = new Uint8Array(total);
    let off = 0;
    for (const b of this.buffers) {
      pcm.set(b, off);
      off += b.length;
    }
    this.buffers = [];

    const rate = this.opts.sampleRate ?? 16000;
    // Dưới ~0.3s coi như nhiễu, khỏi tốn công transcribe.
    if (total < rate * 2 * 0.3) return;

    this.busy = true;
    const dir = await mkdtemp(join(tmpdir(), "whisper-"));
    const wavPath = join(dir, "turn.wav");
    try {
      await writeFile(wavPath, pcm16ToWav(pcm, rate));
      const text = await this.runWhisper(wavPath);
      if (text) this.onTranscript?.({ text, isFinal: true });
    } finally {
      this.busy = false;
      await rm(dir, { recursive: true, force: true });
    }
  }

  stop(): void {
    this.buffers = [];
    this.onTranscript = null;
  }

  private runWhisper(wavPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = [
        "-m", this.opts.modelPath,
        "-f", wavPath,
        "-l", this.opts.language ?? "vi",
        "-t", String(this.opts.threads ?? 4),
        "--no-timestamps",
        "--no-prints",
      ];
      const proc = spawn(this.opts.binPath, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      proc.stdout.on("data", (d: Buffer) => (out += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) reject(new Error(`whisper-cli exit ${code}: ${err.slice(0, 200)}`));
        else resolve(out.replace(/\s+/g, " ").trim());
      });
    });
  }
}
