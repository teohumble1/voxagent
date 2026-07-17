import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { defineAgent, type Agent } from "./agent.js";
import type { ProviderName } from "./provider.js";

/**
 * Bọc một agent thành một tool để agent khác gọi được.
 * Đây là pattern "agent-as-tool": orchestrator không tự làm mọi thứ mà
 * uỷ thác từng nhiệm vụ con cho chuyên gia phù hợp.
 */
export function agentAsTool(agent: Agent, description: string) {
  return tool({
    description,
    inputSchema: z.object({
      task: z.string().describe("Nhiệm vụ cụ thể giao cho chuyên gia này"),
    }),
    execute: async ({ task }) => {
      const result = await agent.generate(task);
      return { specialist: agent.name, answer: result.text };
    },
  });
}

export interface Specialist {
  agent: Agent;
  /** Mô tả để orchestrator biết khi nào nên gọi chuyên gia này. */
  description: string;
}

const ORCHESTRATOR_SYSTEM =
  "Bạn là điều phối viên. Phân tích yêu cầu người dùng, chia thành các nhiệm vụ con, " +
  "và gọi đúng chuyên gia (qua tool) để xử lý từng phần. " +
  "Sau khi có kết quả từ các chuyên gia, tổng hợp lại thành câu trả lời cuối cùng, mạch lạc.";

/**
 * Tạo một orchestrator điều phối nhiều chuyên gia. Mỗi chuyên gia được phơi ra
 * dưới dạng một tool; orchestrator tự quyết định gọi ai, theo thứ tự nào.
 */
export function createOrchestrator(
  specialists: Record<string, Specialist>,
  options: { provider?: ProviderName; maxSteps?: number } = {},
): Agent {
  const tools: ToolSet = {};
  for (const [name, spec] of Object.entries(specialists)) {
    tools[name] = agentAsTool(spec.agent, spec.description);
  }

  return defineAgent({
    name: "orchestrator",
    system: ORCHESTRATOR_SYSTEM,
    tools,
    provider: options.provider,
    // orchestrator cần nhiều bước hơn: mỗi lần gọi chuyên gia là 1 bước.
    maxSteps: options.maxSteps ?? 8,
  });
}
