import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpServer, embedMcpServer, MockBrowser } from "./index.js";

function makeBrowser(): MockBrowser {
  return new MockBrowser({
    "https://vd.local/home": {
      title: "Trang chủ",
      text: "Chào mừng tới VoxAgent demo.",
      links: [{ text: "Giới thiệu", href: "https://vd.local/about" }],
    },
    "https://vd.local/about": {
      title: "Giới thiệu",
      text: "VoxAgent là trợ lý thoại real-time.",
      links: [{ text: "Về trang chủ", href: "https://vd.local/home" }],
    },
  });
}

async function callText(
  tools: Record<string, { execute?: (a: unknown, o: unknown) => unknown }>,
  name: string,
  args: unknown,
): Promise<string> {
  const exec = tools[name]?.execute;
  assert.ok(exec, `thiếu tool ${name}`);
  return String(await exec(args, {}));
}

test("MCP round-trip + agentic browsing (navigate/extract/click)", async () => {
  const server = createMcpServer(makeBrowser());
  const { tools, close } = await embedMcpServer(server);

  assert.ok(
    ["browser_navigate", "browser_extract_text", "browser_links", "browser_click"].every((t) => t in tools),
  );

  const nav = await callText(tools, "browser_navigate", { url: "https://vd.local/home" });
  assert.match(nav, /Trang chủ/);

  const text = await callText(tools, "browser_extract_text", {});
  assert.match(text, /Chào mừng/);

  const clicked = await callText(tools, "browser_click", { linkText: "Giới thiệu" });
  assert.match(clicked, /about/);

  const text2 = await callText(tools, "browser_extract_text", {});
  assert.match(text2, /real-time/);

  const bad = await callText(tools, "browser_navigate", { url: "https://vd.local/none" });
  assert.match(bad, /404/);

  await close();
});
