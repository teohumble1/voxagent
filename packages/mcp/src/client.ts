import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonSchema, tool, type ToolSet } from "ai";

/** Trích phần text từ kết quả callTool của MCP. */
function resultText(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}

/**
 * Biến toàn bộ tool của một MCP client thành AI SDK ToolSet để agent gọi được.
 * Đây là cây cầu MCP <-> agent: schema JSON của MCP -> jsonSchema() của AI SDK,
 * còn execute thì uỷ thác về client.callTool().
 */
export async function mcpToolSet(client: Client): Promise<ToolSet> {
  const { tools } = await client.listTools();
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = tool({
      description: t.description ?? t.name,
      inputSchema: jsonSchema((t.inputSchema ?? { type: "object" }) as object),
      execute: async (args: unknown) => {
        const result = await client.callTool({
          name: t.name,
          arguments: (args ?? {}) as Record<string, unknown>,
        });
        return resultText(result);
      },
    });
  }
  return set;
}

/**
 * Kết nối một Client tới một Transport rồi trả về ToolSet đã adapt.
 */
export async function connectMcpTools(
  transport: Transport,
  clientInfo = { name: "voxagent-client", version: "0.0.1" },
): Promise<{ client: Client; tools: ToolSet }> {
  const client = new Client(clientInfo);
  await client.connect(transport);
  const tools = await mcpToolSet(client);
  return { client, tools };
}

/**
 * Tiện ích: nối một McpServer với một Client qua transport in-memory (không spawn
 * process), trả về ToolSet. Dùng để nhúng MCP server ngay trong tiến trình + test.
 */
export async function embedMcpServer(
  server: McpServer,
): Promise<{ client: Client; tools: ToolSet; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const { client, tools } = await connectMcpTools(clientTransport);
  return {
    client,
    tools,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
