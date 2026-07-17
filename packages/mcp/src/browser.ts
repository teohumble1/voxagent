export interface Link {
  text: string;
  href: string;
}

export interface Page {
  url: string;
  title: string;
  text: string;
  links: Link[];
}

/**
 * Trừu tượng hoá trình duyệt cho agent điều khiển. Bản thật dùng Playwright
 * (mở được trang JS-nặng, click, gõ phím); bản mock/fetch cho test & trang tĩnh.
 */
export interface BrowserController {
  navigate(url: string): Promise<Page>;
  extractText(): Promise<string>;
  links(): Promise<Link[]>;
  /** Click một link theo text hiển thị của nó. */
  click(linkText: string): Promise<Page>;
  current(): Page | null;
}

/**
 * Trình duyệt giả: một "web" trong bộ nhớ (url → trang). Deterministic, hợp test
 * và demo agentic browsing mà không cần mạng hay Playwright.
 */
export class MockBrowser implements BrowserController {
  private page: Page | null = null;

  constructor(private readonly site: Record<string, Omit<Page, "url">>) {}

  async navigate(url: string): Promise<Page> {
    const found = this.site[url];
    if (!found) throw new Error(`404: không có trang ${url}`);
    this.page = { url, ...found };
    return this.page;
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
    if (!this.page) throw new Error("Chưa mở trang nào.");
    const link = this.page.links.find((l) => l.text === linkText);
    if (!link) throw new Error(`Không thấy link "${linkText}" trên trang.`);
    return this.navigate(link.href);
  }

  current(): Page | null {
    return this.page;
  }
}

/**
 * Trình duyệt thật tối giản: fetch HTML rồi bóc text/link bằng regex.
 * Đủ cho trang tĩnh; trang cần JS/tương tác thì thay bằng Playwright (cùng interface).
 */
export class FetchBrowser implements BrowserController {
  private page: Page | null = null;

  async navigate(url: string): Promise<Page> {
    const res = await fetch(url);
    const html = await res.text();
    this.page = { url, ...parseHtml(html) };
    return this.page;
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
    if (!this.page) throw new Error("Chưa mở trang nào.");
    const link = this.page.links.find((l) => l.text.includes(linkText));
    if (!link) throw new Error(`Không thấy link "${linkText}".`);
    return this.navigate(new URL(link.href, this.page.url).toString());
  }

  current(): Page | null {
    return this.page;
  }
}

function parseHtml(html: string): Omit<Page, "url"> {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const links: Link[] = [];
  const linkRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.push({ href: m[1] ?? "", text: stripTags(m[2] ?? "").trim() });
  }
  const text = stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  return { title: (titleMatch?.[1] ?? "").trim(), text, links };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}
