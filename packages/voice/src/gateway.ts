import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import type { Agent } from "@voxagent/agent-core";
import { VoiceSession } from "./session.js";
import type { SttProvider, TtsProvider } from "./types.js";

export interface VoiceGatewayOptions {
  agent: Agent;
  /** Tạo MỘT STT provider cho mỗi kết nối (mỗi client một socket STT riêng). */
  createStt: () => SttProvider;
  tts: TtsProvider;
  /** Gắn vào http server có sẵn, hoặc mở cổng riêng. */
  server?: Server;
  port?: number;
  path?: string;
}

/**
 * Cổng thoại real-time qua WebSocket. Mỗi client:
 *  - gửi khung audio (binary)  -> đẩy vào STT
 *  - gửi control JSON {type:"speech_start"|"speech_end"} (client-side VAD)
 *  - nhận lại: audio TTS (binary) + sự kiện session (JSON: state/barge-in/latency)
 *
 * Đây là tầng TRANSPORT tách rời — WebRTC có thể thay WebSocket ở đây mà không đụng
 * VoiceSession. WebSocket đủ tốt cho nhiều ca; WebRTC hơn ở độ trễ mạng kém.
 */
export function createVoiceGateway(opts: VoiceGatewayOptions): WebSocketServer {
  const wss = opts.server
    ? new WebSocketServer({ server: opts.server, path: opts.path ?? "/voice" })
    : new WebSocketServer({ port: opts.port ?? 8789, path: opts.path ?? "/voice" });

  wss.on("connection", (ws: WebSocket) => {
    const stt = opts.createStt();
    const session = new VoiceSession({
      agent: opts.agent,
      tts: opts.tts,
      onEvent: (event) => {
        if (ws.readyState !== ws.OPEN) return;
        if (event.type === "tts-audio") ws.send(event.chunk.data);
        else ws.send(JSON.stringify(event));
      },
    });

    stt.start((t) => session.transcript(t.text, t.isFinal));
    session.start();

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        session.speechStart(); // có audio tới -> coi như đang nói (kích barge-in nếu cần)
        stt.pushAudio({ data: new Uint8Array(data) });
        return;
      }
      try {
        const msg = JSON.parse(data.toString()) as { type?: string };
        if (msg.type === "speech_end") {
          // STT batch (Whisper local) cần flush xong mới có final transcript.
          void Promise.resolve(stt.flush?.())
            .catch(() => undefined)
            .then(() => session.endTurn());
        }
      } catch {
        /* bỏ qua control message hỏng */
      }
    });

    ws.on("close", () => stt.stop());
    ws.on("error", () => stt.stop());
  });

  return wss;
}
