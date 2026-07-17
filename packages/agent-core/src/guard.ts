import type { ToolSet } from "ai";

export type RiskLevel = "low" | "medium" | "high";

export interface GuardPolicy {
  /** Độ dài input tối đa (ký tự). Mặc định 8000. */
  maxInputLength?: number;
  /** Chặn hẳn input bị đánh giá high-risk. Mặc định true. */
  blockHighRisk?: boolean;
  /** Nếu set, agent chỉ được gọi các tool có tên trong danh sách này. */
  allowedTools?: string[];
  /** Che nếu output lỡ lộ nguyên văn system prompt. Mặc định true. */
  redactSystemPrompt?: boolean;
}

interface Rule {
  name: string;
  risk: RiskLevel;
  re: RegExp;
}

/**
 * Bộ luật nhận diện prompt-injection phổ biến. Không hoàn hảo (không bộ luật nào
 * hoàn hảo) — đây là lớp phòng thủ đầu, kết hợp cùng tool allowlist + output filter.
 */
const RULES: Rule[] = [
  { name: "override-instructions", risk: "high", re: /\b(ignore|disregard|forget|bỏ qua|quên)\b.{0,30}\b(previous|above|prior|all|mọi|các|những)?\b.{0,20}\b(instruction|prompt|rule|chỉ dẫn|hướng dẫn|lệnh)/i },
  { name: "reveal-system-prompt", risk: "high", re: /\b(reveal|show|print|repeat|leak|in ra|tiết lộ|đọc)\b.{0,30}\b(system|initial|hidden|your)\b.{0,10}\b(prompt|instruction|message|chỉ dẫn)/i },
  { name: "role-override", risk: "medium", re: /\b(you are now|from now on|act as|pretend to be|bạn giờ là|đóng vai|giả vờ là)\b/i },
  { name: "jailbreak-persona", risk: "high", re: /\b(DAN|do anything now|developer mode|jailbreak|unfiltered|no restrictions|không giới hạn)\b/i },
  { name: "delimiter-injection", risk: "high", re: /(<\|im_(start|end)\|>|\[\/?INST\]|```+\s*system|<system>|###\s*system)/i },
  { name: "exfiltration", risk: "high", re: /\b(send|post|upload|gửi|đăng)\b.{0,40}\b(https?:\/\/|api key|token|password|secret|mật khẩu)/i },
  { name: "tool-abuse", risk: "medium", re: /\b(call|invoke|use)\b.{0,20}\b(tool|function)\b.{0,30}\b(delete|drop|rm -rf|shutdown|format)/i },
];

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export interface InputVerdict {
  risk: RiskLevel;
  allowed: boolean;
  matches: string[];
}

export class GuardBlockedError extends Error {
  constructor(public readonly verdict: InputVerdict) {
    super(
      `Input bị chặn bởi guard (risk=${verdict.risk}): ${verdict.matches.join(", ")}`,
    );
    this.name = "GuardBlockedError";
  }
}

/** Soi input người dùng, chấm mức rủi ro và quyết định cho qua hay chặn. */
export function inspectInput(
  input: string,
  policy: GuardPolicy = {},
): InputVerdict {
  const maxLen = policy.maxInputLength ?? 8000;
  const matches: string[] = [];
  let risk: RiskLevel = "low";

  if (input.length > maxLen) {
    matches.push("input-too-long");
    risk = "medium";
  }

  for (const rule of RULES) {
    if (rule.re.test(input)) {
      matches.push(rule.name);
      if (RISK_ORDER[rule.risk] > RISK_ORDER[risk]) risk = rule.risk;
    }
  }

  const blockHigh = policy.blockHighRisk ?? true;
  const allowed = !(blockHigh && risk === "high");
  return { risk, allowed, matches };
}

export interface OutputVerdict {
  text: string;
  redacted: boolean;
}

/**
 * Lọc output: nếu model lỡ nhắc lại nguyên văn system prompt (dấu hiệu bị dụ lộ
 * chỉ dẫn) thì che đi. Đây là lớp phòng thủ phía ra.
 */
export function sanitizeOutput(
  output: string,
  systemPrompt: string,
  policy: GuardPolicy = {},
): OutputVerdict {
  if (policy.redactSystemPrompt === false) return { text: output, redacted: false };

  // So khớp một đoạn đặc trưng của system prompt (>= 24 ký tự) trong output.
  const probe = systemPrompt.slice(0, 60).trim();
  if (probe.length >= 24 && output.includes(probe)) {
    return {
      text: "[đã che: phản hồi có dấu hiệu lộ system prompt]",
      redacted: true,
    };
  }
  return { text: output, redacted: false };
}

/**
 * Bọc tool để cưỡng chế allowlist ở tầng thực thi (defense-in-depth): dù model
 * có cố gọi tool ngoài danh sách, execute sẽ từ chối và ghi log thay vì chạy.
 */
export function guardTools(
  tools: ToolSet,
  policy: GuardPolicy,
  onDeny?: (toolName: string) => void,
): ToolSet {
  if (!policy.allowedTools) return tools;
  const allow = new Set(policy.allowedTools);
  const guarded: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (allow.has(name)) {
      guarded[name] = tool;
      continue;
    }
    const original = tool.execute;
    guarded[name] = {
      ...tool,
      execute: async (...args: Parameters<NonNullable<typeof original>>) => {
        onDeny?.(name);
        return { error: `Tool "${name}" bị guard từ chối (ngoài allowlist).` };
      },
    };
  }
  return guarded;
}
