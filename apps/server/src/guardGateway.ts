/**
 * Client cho agent-guard — sidecar bảo mật out-of-process (Python):
 * https://github.com/teohumble1/agent-guard
 *
 * Lớp phòng thủ thứ hai, độc lập với guard in-process của agent-core:
 * server POST message tới sidecar, sidecar chấm risk (prompt injection
 * EN+VI) + tra bảng policy rồi trả decision. Chỉ bật khi đặt
 * AGENT_GUARD_URL; khi đã bật mà sidecar không phản hồi thì FAIL-CLOSED
 * (chặn) — một guard "đang bật" không được lặng lẽ biến mất.
 */

export interface GatewayVerdict {
  decision: "allow" | "deny" | "needs_approval";
  reason: string;
  ruleIds: string[];
}

const TIMEOUT_MS = 3000;

export async function evaluateWithAgentGuard(
  baseUrl: string,
  message: string,
  agentId: string,
): Promise<GatewayVerdict> {
  try {
    const res = await fetch(new URL("/evaluate", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, tool: "chat", user_input: message }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      decision?: unknown;
      reason?: unknown;
      matched_rules?: unknown;
    };
    // Chỉ "allow" tường minh mới cho qua; mọi giá trị lạ đều coi là deny.
    const decision =
      body.decision === "allow" || body.decision === "needs_approval"
        ? body.decision
        : "deny";
    return {
      decision,
      reason: typeof body.reason === "string" ? body.reason : "",
      ruleIds: Array.isArray(body.matched_rules)
        ? body.matched_rules.filter((r): r is string => typeof r === "string")
        : [],
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      decision: "deny",
      reason: `agent-guard sidecar không phản hồi (${detail}) — fail-closed`,
      ruleIds: [],
    };
  }
}
