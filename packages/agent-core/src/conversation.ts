import type { ModelMessage } from "ai";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Lịch sử hội thoại của MỘT phiên. LLM không tự nhớ giữa các lần gọi, nên muốn
 * chat có ngữ cảnh ta phải gửi lại toàn bộ (hoặc phần gần đây của) lịch sử này.
 *
 * Giới hạn `maxMessages` để không phình context vô hạn (cắt bớt lượt cũ nhất,
 * giữ nguyên tính chẵn user/assistant).
 */
export class Conversation {
  private history: ChatMessage[];

  constructor(initial: ChatMessage[] = [], private readonly maxMessages = 40) {
    this.history = [...initial];
  }

  add(role: ChatMessage["role"], content: string): void {
    this.history.push({ role, content });
    // cắt bớt từ đầu nếu vượt trần (bỏ theo cặp để tránh lệch lượt)
    while (this.history.length > this.maxMessages) {
      this.history.shift();
    }
  }

  messages(): readonly ChatMessage[] {
    return this.history;
  }

  toModelMessages(): ModelMessage[] {
    return this.history.map((m) => ({ role: m.role, content: m.content }));
  }

  clear(): void {
    this.history = [];
  }

  get length(): number {
    return this.history.length;
  }
}
