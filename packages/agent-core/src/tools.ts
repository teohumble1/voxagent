import { tool } from "ai";
import { z } from "zod";

/**
 * Bộ tool mẫu để agent gọi. Mỗi tool = mô tả + schema đầu vào (Zod) + hàm execute.
 * AI SDK tự sinh JSON Schema từ Zod và validate input model gửi lên trước khi chạy.
 */

export const getCurrentTime = tool({
  description: "Lấy ngày giờ hiện tại theo một múi giờ IANA (vd: Asia/Ho_Chi_Minh).",
  inputSchema: z.object({
    timezone: z
      .string()
      .describe("Tên múi giờ IANA, mặc định Asia/Ho_Chi_Minh")
      .default("Asia/Ho_Chi_Minh"),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat("vi-VN", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "medium",
    }).format(now);
    return { timezone, iso: now.toISOString(), formatted };
  },
});

export const calculate = tool({
  description:
    "Tính một biểu thức số học an toàn với +, -, *, /, ngoặc và số thực.",
  inputSchema: z.object({
    expression: z.string().describe("Biểu thức, vd: (12 + 3) * 4 / 2"),
  }),
  execute: async ({ expression }) => {
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      return { error: "Biểu thức chứa ký tự không cho phép." };
    }
    try {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expression});`)() as unknown;
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return { error: "Kết quả không hợp lệ." };
      }
      return { expression, result };
    } catch {
      return { error: "Không phân tích được biểu thức." };
    }
  },
});

export const timeTools = { getCurrentTime };
export const mathTools = { calculate };
export const defaultTools = { getCurrentTime, calculate };
