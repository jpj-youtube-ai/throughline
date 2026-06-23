import puppeteer, { type Browser } from "puppeteer";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  }
  return browserPromise;
}

/** Render a self-contained HTML document to a PNG (REQ-009). Reuses one headless
 *  Chromium across calls (worker-lifetime). Height-capped to keep images bounded. */
export async function renderHtmlToPng(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 600, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const height = Math.min(fullHeight, 2000);
    const buf = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 900, height } });
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    browserPromise = null;
    await b.close();
  }
}
