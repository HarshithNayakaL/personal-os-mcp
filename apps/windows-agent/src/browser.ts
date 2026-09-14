import { chromium, type BrowserContext, type Page, type ElementHandle } from 'playwright';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../../../packages/shared/src/config.js';
import { Paths, redact } from '../../../packages/security/src/index.js';
import { Fault } from '../../../packages/protocol/src/index.js';
export class Browser {
  context?: BrowserContext;
  private current?: Page;
  private tabs = new Map<string, Page>();
  private refs = new Map<string, ElementHandle>();
  private generation = 0;
  constructor(
    private c: Config,
    private paths: Paths,
  ) {}
  async close() {
    const ctx = this.context;
    this.context = undefined;
    this.current = undefined;
    this.tabs.clear();
    await this.invalidate();
    await ctx?.close();
  }
  private async invalidate() {
    this.generation++;
    const handles = [...this.refs.values()];
    this.refs.clear();
    await Promise.all(handles.map((h) => h.dispose().catch(() => {})));
  }
  private track(page: Page) {
    const id = randomUUID();
    this.tabs.set(id, page);
    page.on('close', () => {
      this.tabs.delete(id);
      if (this.current === page) this.current = [...this.tabs.values()][0];
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) void this.invalidate();
    });
    page.on('crash', () => void page.close());
    return id;
  }
  private page() {
    if (!this.current || this.current.isClosed())
      throw new Fault('BROWSER_CLOSED', 'Launch a browser first');
    return this.current;
  }
  private element(ref: string) {
    const h = this.refs.get(ref);
    if (!h) throw new Fault('STALE_REF', 'Reference expired; take a new snapshot');
    return h;
  }
  private url(raw: string) {
    const u = new URL(raw);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password)
      throw new Fault('URL_DENIED', 'Only HTTP(S) URLs without embedded credentials are allowed');
    return u.href;
  }
  async snapshot() {
    const page = this.page();
    await this.invalidate();
    const elements: Array<{ ref: string; role: string; name: string; text: string }> = [];
    const handles = await page
      .locator(
        'a[href],button,input:not([type=password]):not([type=hidden]),textarea,select,[role=button],[role=link],[role=textbox],[role=checkbox],[role=combobox]',
      )
      .elementHandles();
    for (const h of handles) {
      if (elements.length >= 150 || !(await h.isVisible())) {
        await h.dispose();
        continue;
      }
      const info = await h.evaluate((el: any) => {
        const tag = el.tagName.toLowerCase();
        return {
          role:
            el.getAttribute('role') ||
            (
              {
                a: 'link',
                button: 'button',
                input: el.type === 'checkbox' ? 'checkbox' : 'textbox',
                textarea: 'textbox',
                select: 'combobox',
              } as any
            )[tag] ||
            tag,
          name: (
            el.getAttribute('aria-label') ||
            el.labels?.[0]?.textContent ||
            el.getAttribute('placeholder') ||
            el.innerText ||
            ''
          )
            .trim()
            .slice(0, 200),
          text: (el.type === 'password' ? '' : el.innerText || '').trim().slice(0, 200),
        };
      });
      const ref = `e${this.generation}_${elements.length + 1}`;
      this.refs.set(ref, h);
      elements.push({ ref, ...info });
    }
    return redact({
      url: page.url(),
      title: await page.title(),
      elements,
      truncated: handles.length > 150,
    });
  }
  async execute(op: string, a: any): Promise<any> {
    if (op === 'launch') {
      if (this.context) return this.execute('status', {});
      await fs.mkdir(this.c.browserProfile, { recursive: true });
      this.context = await chromium.launchPersistentContext(this.c.browserProfile, {
        headless: this.c.headless,
        acceptDownloads: true,
        timeout: this.c.timeoutMs,
      });
      this.context.setDefaultTimeout(this.c.timeoutMs);
      this.context.on('page', (p) => this.track(p));
      for (const p of this.context.pages()) this.track(p);
      this.current = this.context.pages()[0] ?? (await this.context.newPage());
      return this.execute('status', {});
    }
    if (op === 'close') {
      await this.close();
      return { closed: true };
    }
    if (op === 'status') return { running: !!this.context, tabs: this.tabs.size };
    if (op === 'tabs')
      return Promise.all(
        [...this.tabs].map(async ([tabId, p]) => ({
          tabId,
          url: p.url(),
          title: await p.title(),
          active: p === this.current,
        })),
      );
    if (op === 'new_tab') {
      if (!this.context) throw new Fault('BROWSER_CLOSED', 'Launch first');
      this.current = await this.context.newPage();
      await this.invalidate();
      return this.execute('tabs', {});
    }
    if (op === 'switch_tab' || op === 'close_tab') {
      const p = this.tabs.get(a.tabId);
      if (!p) throw new Fault('TAB_NOT_FOUND', 'Unknown tab');
      if (op === 'close_tab') await p.close();
      else {
        this.current = p;
        await p.bringToFront();
      }
      await this.invalidate();
      return this.execute('tabs', {});
    }
    const p = this.page();
    if (op === 'navigate') {
      await p.goto(this.url(a.url), { waitUntil: 'domcontentloaded' });
      return { url: p.url() };
    }
    if (op === 'back' || op === 'forward' || op === 'reload') {
      if (op === 'back') await p.goBack();
      else if (op === 'forward') await p.goForward();
      else await p.reload();
      return { url: p.url() };
    }
    if (op === 'snapshot') return this.snapshot();
    if (op === 'get_text')
      return { text: redact((await p.locator('body').innerText()).slice(0, 20000)) };
    if (op === 'get_links')
      return redact(
        await p.locator('a[href]').evaluateAll((els) =>
          els.slice(0, 200).map((e) => ({
            text: (e.textContent || '').slice(0, 200),
            url: (e as HTMLAnchorElement).href,
          })),
        ),
      );
    if (op === 'screenshot') {
      const file = await this.paths.mutable(a.path);
      await p.screenshot({ path: file, fullPage: false });
      return { path: file };
    }
    if (op === 'evaluate') {
      const value = await p.evaluate(a.expression);
      const encoded = JSON.stringify(value ?? null);
      if (encoded.length > this.c.maxBytes)
        throw new Fault('OUTPUT_LIMIT', 'Evaluation output too large');
      return redact(value);
    }
    const h = this.element(a.ref);
    if (!(await h.evaluate((el) => el.isConnected)))
      throw new Fault('STALE_REF', 'Element detached; take another snapshot');
    if (op === 'click' || op === 'submit') await h.click();
    else if (op === 'type') await h.fill(a.text);
    else if (op === 'clear') await h.fill('');
    else if (op === 'select') await h.selectOption(a.text);
    else if (op === 'press') await h.press(a.text);
    else if (op === 'hover') await h.hover();
    else if (op === 'upload') await h.setInputFiles(await this.paths.resolve(a.path));
    else if (op === 'download') {
      const requested = a.destination ? await this.paths.mutable(a.destination) : undefined;
      const [download] = await Promise.all([p.waitForEvent('download'), h.click()]);
      const destination =
        requested ??
        (await this.paths.mutable(
          path.join(this.c.downloadDirectory, path.basename(download.suggestedFilename())),
        ));
      await download.saveAs(destination);
      return { path: destination };
    } else if (op === 'wait') await h.waitForElementState('visible');
    else throw new Fault('UNKNOWN_CAPABILITY', op);
    return { done: true };
  }
}
