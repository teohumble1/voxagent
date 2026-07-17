import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BrowserController } from "./browser.js";

interface TextResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function ok(text: string): TextResult {
  return { content: [{ type: "text", text }] };
}
function err(text: string): TextResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Tạo một MCP server phơi các tool điều khiển trình duyệt + tiện ích. Bất kỳ MCP
 * client nào (Claude Desktop, agent của ta, IDE...) đều gọi được các tool này.
 */
export function createMcpServer(browser: BrowserController): McpServer {
  const server = new McpServer({ name: "voxagent-mcp", version: "0.0.1" });

  server.registerTool(
    "browser_navigate",
    {
      description: "Mở một URL trong trình duyệt và trả về tiêu đề trang.",
      inputSchema: { url: z.string().describe("URL đầy đủ cần mở") },
    },
    async ({ url }) => {
      try {
        const page = await browser.navigate(url);
        return ok(`Đã mở "${page.title}" (${page.links.length} link).`);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "browser_extract_text",
    {
      description: "Lấy toàn bộ text của trang đang mở.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await browser.extractText());
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "browser_links",
    {
      description: "Liệt kê các link (text + href) trên trang đang mở.",
      inputSchema: {},
    },
    async () => {
      try {
        const links = await browser.links();
        return ok(links.map((l) => `- ${l.text} -> ${l.href}`).join("\n") || "(không có link)");
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "browser_click",
    {
      description: "Click một link theo text hiển thị và mở trang đích.",
      inputSchema: { linkText: z.string().describe("Text của link cần click") },
    },
    async ({ linkText }) => {
      try {
        const page = await browser.click(linkText);
        return ok(`Đã tới "${page.title}" (${page.url}).`);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  );

  return server;
}
