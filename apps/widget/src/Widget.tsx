import { useCallback, useRef, useState } from "react";
import { streamChat } from "./sse";

export interface WidgetOptions {
  /** URL server VoxAgent, vd http://localhost:8787 */
  endpoint: string;
  title?: string;
  accent?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

const styles = {
  bubble: (accent: string): React.CSSProperties => ({
    position: "fixed", right: 20, bottom: 20, width: 56, height: 56,
    borderRadius: "50%", background: accent, color: "#fff", border: "none",
    fontSize: 24, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,.25)", zIndex: 2147483000,
  }),
  panel: {
    position: "fixed", right: 20, bottom: 88, width: 340, height: 460,
    background: "#fff", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,.24)",
    display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 2147483000,
    fontFamily: "system-ui, sans-serif",
  } as React.CSSProperties,
  header: (accent: string): React.CSSProperties => ({
    background: accent, color: "#fff", padding: "12px 16px", fontWeight: 600,
  }),
  log: { flex: 1, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 } as React.CSSProperties,
  row: (me: boolean): React.CSSProperties => ({ alignSelf: me ? "flex-end" : "flex-start", maxWidth: "80%" }),
  msg: (me: boolean, accent: string): React.CSSProperties => ({
    background: me ? accent : "#f0f0f3", color: me ? "#fff" : "#111",
    padding: "8px 12px", borderRadius: 12, fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word",
  }),
  form: { display: "flex", borderTop: "1px solid #eee" } as React.CSSProperties,
  input: { flex: 1, border: "none", padding: 12, fontSize: 14, outline: "none" } as React.CSSProperties,
};

export function Widget({ endpoint, title = "VoxAgent", accent = "#4f46e5" }: WidgetOptions): JSX.Element {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: "" }]);
      setBusy(true);
      scrollDown();
      try {
        for await (const ev of streamChat(endpoint, text)) {
          if (ev.type === "token") {
            setMessages((m) => {
              const copy = m.slice();
              const last = copy[copy.length - 1];
              if (last) copy[copy.length - 1] = { ...last, text: last.text + ev.text };
              return copy;
            });
            scrollDown();
          } else if (ev.type === "blocked") {
            setMessages((m) => patchLast(m, `🛡️ ${ev.message}`));
          } else if (ev.type === "error") {
            setMessages((m) => patchLast(m, `⚠️ ${ev.message}`));
          }
        }
      } catch (err) {
        setMessages((m) => patchLast(m, `⚠️ ${err instanceof Error ? err.message : "lỗi kết nối"}`));
      } finally {
        setBusy(false);
        scrollDown();
      }
    },
    [endpoint, scrollDown],
  );

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    void send(text);
  };

  return (
    <>
      {open && (
        <div style={styles.panel}>
          <div style={styles.header(accent)}>{title}</div>
          <div ref={logRef} style={styles.log}>
            {messages.map((m, i) => (
              <div key={i} style={styles.row(m.role === "user")}>
                <div style={styles.msg(m.role === "user", accent)}>{m.text || "…"}</div>
              </div>
            ))}
          </div>
          <form style={styles.form} onSubmit={onSubmit}>
            <input
              style={styles.input}
              value={input}
              placeholder={busy ? "Đang trả lời…" : "Nhập tin nhắn…"}
              onChange={(e) => setInput(e.target.value)}
            />
          </form>
        </div>
      )}
      <button style={styles.bubble(accent)} onClick={() => setOpen((o) => !o)} aria-label="VoxAgent">
        {open ? "×" : "💬"}
      </button>
    </>
  );
}

function patchLast(messages: Message[], text: string): Message[] {
  const copy = messages.slice();
  const last = copy[copy.length - 1];
  if (last) copy[copy.length - 1] = { ...last, text };
  return copy;
}
