import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  defineAgent,
  Conversation,
  GuardBlockedError,
  hasKey,
  type Agent,
} from "@voxagent/agent-core";
import { checkAuth, RateLimiter } from "./security.js";
import { evaluateWithAgentGuard } from "./guardGateway.js";
import { createVoiceGateway, DeepgramStt, ElevenLabsTts } from "@voxagent/voice";

const PORT = Number(process.env.PORT ?? 8787);
const API_TOKEN = process.env.VOXAGENT_API_TOKEN; // bật auth khi có
// Sidecar agent-guard (Python) — lớp phòng thủ thứ hai, bật khi đặt URL.
const AGENT_GUARD_URL = process.env.AGENT_GUARD_URL;
const MAX_BODY = 16 * 1024; // 16KB: chống payload lớn
const SESSION_TTL_MS = 30 * 60_000;
const MAX_SESSIONS = 1000;

const agent: Agent = defineAgent({ name: "server", guard: { blockHighRisk: true } });
const limiter = new RateLimiter(30, 60_000);
setInterval(() => limiter.sweep(), 60_000).unref();

// Phiên hội thoại theo sessionId (để chat có ngữ cảnh).
const sessions = new Map<string, { conv: Conversation; lastUsed: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastUsed > SESSION_TTL_MS) sessions.delete(id);
}, 60_000).unref();

function getConversation(sessionId: string | undefined): Conversation {
  if (!sessionId) return new Conversation();
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing.conv;
  }
  if (sessions.size >= MAX_SESSIONS) {
    // bỏ session cũ nhất
    const oldest = [...sessions.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (oldest) sessions.delete(oldest[0]);
  }
  const conv = new Conversation();
  sessions.set(sessionId, { conv, lastUsed: Date.now() });
  return conv;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0]!.trim();
  return req.socket.remoteAddress ?? "unknown";
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Đọc body có GIỚI HẠN kích thước; vượt -> ném để trả 413. */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 1) Auth
  if (!checkAuth(req.headers.authorization, API_TOKEN)) {
    json(res, 401, { error: "Unauthorized" });
    return;
  }
  // 2) Rate limit
  if (!limiter.allow(clientIp(req))) {
    json(res, 429, { error: "Quá nhiều yêu cầu, thử lại sau." });
    return;
  }

  let message = "";
  let sessionId: string | undefined;
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}") as { message?: unknown; sessionId?: unknown };
    message = String(body.message ?? "").trim();
    sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  } catch (e) {
    if (e instanceof Error && e.message === "PAYLOAD_TOO_LARGE") json(res, 413, { error: "Body quá lớn" });
    else json(res, 400, { error: "Body phải là JSON { message, sessionId? }" });
    return;
  }
  if (!message) {
    json(res, 400, { error: "Thiếu 'message'." });
    return;
  }

  cors(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  req.on("close", () => controller.abort());

  // Lớp 1: agent-guard sidecar (nếu bật) — chặn trước khi chạm vào agent.
  if (AGENT_GUARD_URL) {
    const verdict = await evaluateWithAgentGuard(AGENT_GUARD_URL, message, "voxagent-server");
    if (verdict.decision !== "allow") {
      const rules = verdict.ruleIds.length ? ` [${verdict.ruleIds.join(", ")}]` : "";
      send("blocked", { message: `agent-guard: ${verdict.reason}${rules}` });
      res.end();
      return;
    }
  }

  try {
    const conv = getConversation(sessionId);
    const stream = agent.chatStream(conv, message, { signal: controller.signal });
    let next = await stream.next();
    while (!next.done) {
      send("token", { text: next.value });
      next = await stream.next();
    }
    send("done", { provider: next.value });
  } catch (err) {
    if (controller.signal.aborted) return;
    if (err instanceof GuardBlockedError) send("blocked", { message: err.message });
    else send("error", { message: err instanceof Error ? err.message : String(err) });
  } finally {
    res.end();
  }
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    json(res, 200, {
      ok: true,
      auth: Boolean(API_TOKEN),
      hasAnthropic: hasKey("anthropic"),
      hasOpenAI: hasKey("openai"),
      agentGuard: Boolean(AGENT_GUARD_URL),
      sessions: sessions.size,
    });
    return;
  }
  if (req.method === "POST" && req.url === "/chat") {
    void handleChat(req, res);
    return;
  }
  json(res, 404, { error: "Not found" });
});

// Voice real-time (WS /voice) chỉ bật khi có đủ key STT + TTS — an toàn khi thiếu.
const DEEPGRAM = process.env.DEEPGRAM_API_KEY;
const ELEVENLABS = process.env.ELEVENLABS_API_KEY;
function maybeStartVoice(): boolean {
  if (!DEEPGRAM || !ELEVENLABS) return false;
  createVoiceGateway({
    server,
    path: "/voice",
    agent,
    createStt: () => new DeepgramStt(DEEPGRAM, { language: "vi" }),
    tts: new ElevenLabsTts(ELEVENLABS),
  });
  return true;
}

server.listen(PORT, () => {
  const voiceOn = maybeStartVoice();
  console.log(`🚀 VoxAgent server: http://localhost:${PORT}`);
  console.log(`   auth: ${API_TOKEN ? "BẬT (Bearer token)" : "TẮT (dev — đặt VOXAGENT_API_TOKEN để bật)"}`);
  console.log(`   rate limit: 30 req/phút/IP · body max 16KB · session TTL 30 phút`);
  console.log(`   agent-guard sidecar: ${AGENT_GUARD_URL ? `BẬT (${AGENT_GUARD_URL}, fail-closed)` : "TẮT (đặt AGENT_GUARD_URL để bật)"}`);
  console.log(`   voice (WS /voice): ${voiceOn ? "BẬT" : "TẮT (cần DEEPGRAM_API_KEY + ELEVENLABS_API_KEY)"}`);
});
