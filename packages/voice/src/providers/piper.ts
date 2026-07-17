import { spawn } from "node:child_process";
import type { AudioChunk, TtsProvider } from "../types.js";

export interface PiperOptions {
  /** Đường dẫn binary piper (vd trong venv: .../piper-venv/bin/piper). */
  binPath: string;
  /** Đường dẫn model .onnx (file .json cùng tên phải nằm cạnh). */
  modelPath: string;
  /** Sample rate gốc của voice (đọc từ file .onnx.json, vais1000-medium = 22050). */
  nativeRate?: number;
  /** Sample rate đầu ra — khớp client phát (16000). */
  outRate?: number;
}

/**
 * Resample PCM16 mono bằng nội suy tuyến tính. Đủ tốt cho giọng nói;
 * thuần để test không cần binary.
 */
export function resamplePcm16(input: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) return input;
  const outLen = Math.floor((input.length * outRate) / inRate);
  const out = new Int16Array(outLen);
  const ratio = inRate / outRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = Math.round((input[i0] ?? 0) * (1 - frac) + (input[i1] ?? 0) * frac);
  }
  return out;
}

/**
 * TTS local qua Piper — không cần mạng/API key, có giọng tiếng Việt
 * (vi_VN-vais1000). Mỗi câu spawn một tiến trình `piper --output-raw`
 * (PCM16 mono ở nativeRate), resample về outRate rồi đẩy cho client.
 * Tôn trọng AbortSignal: barge-in -> kill tiến trình ngay.
 */
export class PiperTts implements TtsProvider {
  constructor(private readonly opts: PiperOptions) {}

  async synthesize(
    text: string,
    onAudio: (chunk: AudioChunk) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || !text.trim()) return;
    const nativeRate = this.opts.nativeRate ?? 22050;
    const outRate = this.opts.outRate ?? 16000;

    const raw = await this.runPiper(text, signal);
    if (signal.aborted || raw.length < 2) return;

    const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
    const resampled = resamplePcm16(pcm, nativeRate, outRate);

    // Cắt thành khung ~100ms cho client phát mượt (16000Hz * 0.1s * 2 byte).
    const frame = Math.floor(outRate * 0.1) * 2;
    const bytes = new Uint8Array(resampled.buffer, 0, resampled.length * 2);
    for (let off = 0; off < bytes.length; off += frame) {
      if (signal.aborted) return;
      onAudio({ data: bytes.slice(off, Math.min(off + frame, bytes.length)) });
    }
  }

  private runPiper(text: string, signal: AbortSignal): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.opts.binPath,
        ["-m", this.opts.modelPath, "--output-raw"],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const chunks: Buffer[] = [];
      let err = "";
      const onAbort = (): void => {
        proc.kill("SIGKILL");
      };
      signal.addEventListener("abort", onAbort, { once: true });

      proc.stdout.on("data", (d: Buffer) => chunks.push(d));
      proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
      proc.on("error", (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      });
      proc.on("close", (code) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) resolve(new Uint8Array(0));
        else if (code !== 0) reject(new Error(`piper exit ${code}: ${err.slice(0, 200)}`));
        else resolve(Buffer.concat(chunks));
      });

      proc.stdin.write(text);
      proc.stdin.end();
    });
  }
}
