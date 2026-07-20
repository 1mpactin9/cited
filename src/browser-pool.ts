import { chromium, firefox, webkit, Browser } from 'playwright';
import { createLogger } from './logger.js';

const log = createLogger('BrowserPool');

export class BrowserPool {
  private browsers: Map<string, Browser> = new Map();
  private pendingLaunches: Map<string, Promise<Browser>> = new Map();
  private maxBrowsers: number;
  private browserTypes: string[];
  private currentBrowserIndex = 0;
  private lastUsedBrowserType: string = '';

  constructor() {
    this.maxBrowsers = parseInt(process.env.MAX_BROWSERS || '3', 10);
    this.browserTypes = (process.env.BROWSER_TYPES || 'chromium,firefox').split(',').map(t => t.trim());
    log.debug(`configuration: maxBrowsers=${this.maxBrowsers}, types=${this.browserTypes.join(',')}`);
  }

  async getBrowser(): Promise<Browser> {
    const browserType = this.browserTypes[this.currentBrowserIndex % this.browserTypes.length];
    this.currentBrowserIndex++;
    this.lastUsedBrowserType = browserType;

    const cached = this.browsers.get(browserType);
    if (cached && cached.isConnected()) {
      return cached;
    }
    if (cached && !cached.isConnected()) {
      this.browsers.delete(browserType);
      try { await cached.close(); } catch { }
    }

    // Coalesce concurrent launches for the same browser type
    const pending = this.pendingLaunches.get(browserType);
    if (pending) return pending;

    const launchPromise = this.launchBrowser(browserType).finally(() => {
      this.pendingLaunches.delete(browserType);
    });
    this.pendingLaunches.set(browserType, launchPromise);
    return launchPromise;
  }

  private async launchBrowser(browserType: string): Promise<Browser> {
    log.debug(`launching new ${browserType} browser`);
    const launchOptions = {
      headless: true,
      args: [
        '--headless=new',
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-ipc-flooding-protection',
      ],
    };

    let browser: Browser;
    switch (browserType) {
      case 'chromium': browser = await chromium.launch(launchOptions); break;
      case 'firefox': browser = await firefox.launch(launchOptions); break;
      case 'webkit': browser = await webkit.launch(launchOptions); break;
      default: browser = await chromium.launch(launchOptions);
    }

    this.browsers.set(browserType, browser);

    if (this.browsers.size > this.maxBrowsers) {
      // Evict the oldest browser that isn't this one
      for (const [key, b] of this.browsers.entries()) {
        if (key === browserType) continue;
        try { await b.close(); } catch (error) { log.error('error closing old browser', error); }
        this.browsers.delete(key);
        break;
      }
    }

    return browser;
  }

  async closeAll(): Promise<void> {
    log.debug(`closing ${this.browsers.size} browsers`);
    const closePromises = Array.from(this.browsers.values()).map(browser =>
      browser.close().catch(error => log.error('error closing browser', error))
    );
    await Promise.all(closePromises);
    this.browsers.clear();
    this.pendingLaunches.clear();
  }

  getLastUsedBrowserType(): string {
    return this.lastUsedBrowserType;
  }
}
