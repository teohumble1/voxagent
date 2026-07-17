/**
 * Gom các delta text từ agent thành từng "câu" để đẩy sang TTS sớm nhất có thể.
 * Nói câu đầu ngay khi có dấu kết câu, không chờ agent sinh xong toàn bộ →
 * giảm mạnh độ trễ "người dùng nghe thấy tiếng nói đầu tiên".
 */
export class SentenceChunker {
  private buffer = "";
  // Kết câu tại . ! ? … hoặc xuống dòng, kể cả khi theo sau là dấu đóng ngoặc/nháy.
  private static readonly BOUNDARY = /[.!?…]["')\]]?\s|[\n\r]+/;

  /** Nạp thêm delta, trả về các câu đã hoàn chỉnh (có thể rỗng). */
  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    let match: RegExpMatchArray | null;
    while ((match = this.buffer.match(SentenceChunker.BOUNDARY)) !== null) {
      const end = (match.index ?? 0) + match[0].length;
      const sentence = this.buffer.slice(0, end).trim();
      if (sentence) out.push(sentence);
      this.buffer = this.buffer.slice(end);
    }
    return out;
  }

  /** Phần còn lại chưa có dấu kết câu (gọi khi stream kết thúc). */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest || null;
  }
}
