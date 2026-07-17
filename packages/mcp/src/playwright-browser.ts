import { chromium, type Browser, type Page as PwPage } from "playwright";
import type { BrowserController, Link, Page } from "./browser.js";

/**
 * BrowserController thật bằng Playwright (Chromium headless). Mở được trang JS-nặng,
 * click phần tử thật, đọc text đã render. Cùng interface với MockBrowser/FetchBrowser
 * nên MCP server chỉ việc đổi bản dùng — không sửa tool.
 *
 * Lưu ý: cần tải browser binary một lần: `npx playwright install chromium`.
 */
export interface PlaywrightOptions {
  headless?: boolean;
  /** Trỏ tới Chrome/Chromium đã cài sẵn (khi không tải được binary của Playwright). */
  executablePath?: string;
  /** Hoặc dùng kênh có sẵn, vd "chrome", "msedge". */
  channel?: string;
}

export class PlaywrightBrowser implements BrowserController {
  private browser: Browser | null = null;
  private pw: PwPage | null = null;
  private page: Page | null = null;

  constructor(private readonly opts: PlaywrightOptions = {}) {}

  private async ensure(): Promise<PwPage> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.opts.headless ?? true,
        executablePath: this.opts.executablePath ?? process.env.CHROME_PATH,
        channel: this.opts.channel,
      });
      this.pw = await this.browser.newPage();
    }
    return this.pw!;
  }

  private async snapshot(): Promise<Page> {
    const pw = this.pw!;
    const title = await pw.title();
    const text = (await pw.innerText("body").catch(() => "")).replace(/\s+/g, " ").trim();
    const links: Link[] = await pw.$$eval("a[href]", (els) =>
      els.map((e) => ({
        text: (e.textContent ?? "").trim(),
        href: (e as HTMLAnchorElement).href,
      })),
    );
    this.page = { url: pw.url(), title, text, links };
    return this.page;
  }

  async navigate(url: string): Promise<Page> {
    const pw = await this.ensure();
    await pw.goto(url, { waitUntil: "domcontentloaded" });
    return this.snapshot();
  }

  async extractText(): Promise<string> {
    if (!this.page) throw new Error("Chưa mở trang nào.");
    return this.page.text;
  }

  async links(): Promise<Link[]> {
    if (!this.page) throw new Error("Chưa mở trang nào.");
    return this.page.links;
  }

  async click(linkText: string): Promise<Page> {
    const pw = await this.ensure();
    await pw.getByText(linkText, { exact: false }).first().click();
    await pw.waitForLoadState("domcontentloaded");
    return this.snapshot();
  }

  current(): Page | null {
    return this.page;
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.pw = null;
  }
}
