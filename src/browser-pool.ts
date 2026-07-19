import { chromium, firefox, webkit, Browser } from 'playwright';
import { createLogger } from './logger.js';

const log = createLogger('BrowserPool');

export class BrowserPool {
  private browsers: Map<string, Browser> = new Map();
  private maxBrowsers: number;
  private browserTypes: string[];
  private currentBrowserIndex = 0;
  private headless: boolean;
  private lastUsedBrowserType: string = '';

  constructor() {
    this.maxBrowsers = parseInt(process.env.MAX_BROWSERS || '3', 10);
    this.headless = process.env.BROWSER_HEADLESS !== 'false';
    this.browserTypes = (process.env.BROWSER_TYPES || 'chromium,firefox').split(',').map(t => t.trim());
    log.debug(`configuration: maxBrowsers=${this.maxBrowsers}, headless=${this.headless}, types=${this.browserTypes.join(',')}`);
  }

  async getBrowser(): Promise<Browser> {
    const browserType = this.browserTypes[this.currentBrowserIndex % this.browserTypes.length];
    this.currentBrowserIndex++;
    this.lastUsedBrowserType = browserType;

    if (this.browsers.has(browserType)) {
      const browser = this.browsers.get(browserType)!;
      try {
        if (browser.isConnected()) {
          const testContext = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          });
          await testContext.close();
          return browser;
        }
      } catch (error) {
        log.debug(`browser ${browserType} health check failed`, error);
        this.browsers.delete(browserType);
        try { await browser.close(); } catch { /* already gone */ }
      }
    }

    log.debug(`launching new ${browserType} browser`);
    const launchOptions = {
      headless: this.headless,
      args: [
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
      const oldest = this.browsers.entries().next().value;
      if (oldest) {
        try { await oldest[1].close(); } catch (error) { log.error('error closing old browser', error); }
        this.browsers.delete(oldest[0]);
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
  }

  getLastUsedBrowserType(): string {
    return this.lastUsedBrowserType;
  }
}
