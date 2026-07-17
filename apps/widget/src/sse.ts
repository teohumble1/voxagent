/** Sự kiện server đẩy về (khớp SSE của @voxagent/server). Union phân biệt theo `type`. */
export type ChatEvent =
  | { type: "token"; text: string }
  | { type: "done"; provider: string }
  | { type: "blocked"; message: string }
  | { type: "error"; message: string };

function parseFrame(frame: string): ChatEvent | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  const payload = JSON.parse(data) as Record<string, unknown>;
  switch (event) {
    case "token":
      return { type: "token", text: String(payload.text ?? "") };
    case "done":
      return { type: "done", provider: String(payload.provider ?? "") };
    case "blocked":
      return { type: "blocked", message: String(payload.message ?? "") };
    case "error":
      return { type: "error", message: String(payload.message ?? "") };
    default:
      return null;
  }
}

/** Gọi /chat và yield từng ChatEvent khi token về (streaming qua fetch ReadableStream). */
export async function* streamChat(
  endpoint: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const res = await fetch(`${endpoint}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const ev = parseFrame(frame);
      if (ev) yield ev;
    }
  }
}
