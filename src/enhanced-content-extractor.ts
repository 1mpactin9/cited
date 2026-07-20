import axios from 'axios';
import * as cheerio from 'cheerio';
import { ContentExtractionOptions, SearchResult } from './types.js';
import { cleanText, getWordCount, getContentPreview, generateTimestamp, isPdfUrl } from './utils.js';
import { BrowserPool } from './browser-pool.js';
import { createLogger } from './logger.js';

const log = createLogger('ContentExtractor');

export class EnhancedContentExtractor {
  private readonly defaultTimeout: number;
  private readonly maxContentLength: number;
  private browserPool: BrowserPool;

  constructor() {
    this.defaultTimeout = parseInt(process.env.DEFAULT_TIMEOUT || '6000', 10);
    const envMaxLength = process.env.MAX_CONTENT_LENGTH;
    this.maxContentLength = envMaxLength ? parseInt(envMaxLength, 10) : 500000;
    if (isNaN(this.maxContentLength) || this.maxContentLength < 0) {
      log.warn(`invalid MAX_CONTENT_LENGTH value: ${envMaxLength}, using default 500000`);
      this.maxContentLength = 500000;
    }
    this.browserPool = new BrowserPool();
    log.debug(`configuration: timeout=${this.defaultTimeout}, maxContentLength=${this.maxContentLength}`);
  }

  async extractContent(options: ContentExtractionOptions): Promise<string> {
    const { url, signal } = options;
    log.debug(`extracting: ${url}`);
    if (signal?.aborted) throw new Error('Extraction aborted');
    try {
      const content = await this.extractWithAxios(options);
      log.debug(`axios extracted ${content.length} chars: ${url}`);
      return content;
    } catch (error) {
      log.failure(`axios extraction failed for ${url}`, error instanceof Error ? error.message : 'unknown');
      if (signal?.aborted) throw new Error('Extraction aborted');
      if (this.shouldUseBrowser(error, url)) {
        log.info(`falling back to headless browser: ${url}`);
        try {
          const content = await this.extractWithBrowser(options);
          log.debug(`browser extracted ${content.length} chars: ${url}`);
          if (this.isLowQualityContent(content, true)) {
            throw new Error('thin content — likely JS-only or gated page');
          }
          return content;
        } catch (browserError) {
          if (signal?.aborted) {
            log.debug(`browser extraction aborted (timeout): ${url}`);
          } else {
            log.error(`browser extraction also failed: ${url}`, browserError);
          }
          const msg = browserError instanceof Error ? browserError.message : String(browserError);
          throw new Error(`Both axios and browser extraction failed for ${url}: ${msg}`);
        }
      }
      throw error;
    }
  }

  private async extractWithAxios(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout, maxContentLength = this.maxContentLength } = options;
    const response = await axios.get(url, {
      headers: this.getRandomHeaders(),
      timeout,
      validateStatus: (status: number) => status < 400,
    });

    const rawHtml = typeof response.data === 'string' ? response.data : '';
    const hadScripts = /<script[\s>]/i.test(rawHtml);
    let content = this.parseContent(rawHtml || response.data);
    if (maxContentLength && content.length > maxContentLength) {
      content = content.substring(0, maxContentLength);
    }
    if (this.isLowQualityContent(content, hadScripts)) {
      throw new Error('Low quality content detected - likely bot detection or JS-only page');
    }
    return content;
  }

  private async extractWithBrowser(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout, signal } = options;
    const browser = await this.browserPool.getBrowser();
    const browserType = this.browserPool.getLastUsedBrowserType();

    const baseContextOptions = {
      userAgent: this.getRandomUserAgent(),
      viewport: this.getRandomViewport(),
      locale: 'en-US',
      timezoneId: this.getRandomTimezone(),
      deviceScaleFactor: Math.random() > 0.5 ? 1 : 2,
      hasTouch: Math.random() > 0.7,
    };
    const isFirefox = browserType === 'firefox' ||
      browserType.includes('firefox') ||
      browser.constructor.name.toLowerCase().includes('firefox');
    const contextOptions = isFirefox
      ? baseContextOptions
      : { ...baseContextOptions, isMobile: Math.random() > 0.8 };

    const context = await browser.newContext(contextOptions);
    let abortListener: (() => void) | null = null;
    if (signal) {
      abortListener = () => {
        log.debug(`abort signal fired, closing context: ${url}`);
        context.close().catch(() => { });
      };
      signal.addEventListener('abort', abortListener, { once: true });
      if (signal.aborted) {
        signal.removeEventListener('abort', abortListener);
        await context.close().catch(() => { });
        throw new Error('Extraction aborted');
      }
    }

    await context.addInitScript(() => {
      const g = globalThis as any;
      Object.defineProperty(g.navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(g.navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(g.navigator, 'languages', { get: () => ['en-US', 'en'] });
      const originalQuery = g.navigator.permissions.query;
      g.navigator.permissions.query = (parameters: any) => (
        parameters.name === 'notifications'
          ? Promise.resolve({ state: 'default' })
          : originalQuery(parameters)
      );
      if (g.chrome) {
        delete g.chrome.app;
        delete g.chrome.runtime;
      }
    });

    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    try {
      log.debug(`browser navigating to ${url}`);
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: Math.min(timeout, 8000),
        });
      } catch (gotoError) {
        const errorMessage = gotoError instanceof Error ? gotoError.message : String(gotoError);
        if (errorMessage.includes('ERR_HTTP2_PROTOCOL_ERROR') || errorMessage.includes('HTTP2')) {
          log.debug(`HTTP/2 error, retrying with HTTP/1.1: ${url}`);
          await context.close();
          return await this.extractWithBrowserHttp1(browser, url, timeout);
        }
        throw gotoError;
      }

      await page.mouse.move(Math.random() * 100, Math.random() * 100);
      await page.waitForTimeout(500 + Math.random() * 1000);

      try {
        await page.waitForSelector('article, main, .content, .post-content, .entry-content', { timeout: 2000 });
      } catch {
        log.debug(`no main content selector found: ${url}`);
      }

      const html = await page.content();

      // Check for bot detection pages before extracting
      if (html.includes('access denied') || html.includes('security check') ||
          html.includes('verify you are human') || html.includes('blocked')) {
        log.warn(`page blocked access (bot detection): ${url}`);
        throw new Error('Page blocked access (bot detection)');
      }

      const content = this.parseContent(html);
      await context.close();
      if (signal && abortListener) signal.removeEventListener('abort', abortListener);
      return content;
    } catch (error) {
      if (signal?.aborted) {
        log.debug(`browser extraction aborted (timeout): ${url}`);
      } else {
        log.error(`browser extraction failed: ${url}`, error);
      }
      try { await context.close(); } catch { }
      if (signal && abortListener) signal.removeEventListener('abort', abortListener);
      throw error;
    }
  }

  private async extractWithBrowserHttp1(browser: import('playwright').Browser, url: string, timeout: number): Promise<string> {
    const context = await browser.newContext({
      userAgent: this.getRandomUserAgent(),
      viewport: this.getRandomViewport(),
      locale: 'en-US',
      timezoneId: this.getRandomTimezone(),
      extraHTTPHeaders: {
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    });
    const page = await context.newPage();
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'media'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(timeout, 6000) });
      const html = await page.content();
      return this.parseContent(html);
    } finally {
      await context.close();
    }
  }

  private shouldUseBrowser(error: any, url: string): boolean {
    const indicators = [
      error.response?.status === 403,
      error.response?.status === 429,
      error.response?.status === 503,
      error.message?.includes('timeout'),
      error.message?.includes('Access denied'),
      error.message?.includes('Forbidden'),
      error.message?.includes('Low quality content detected'),
      error.response?.data?.includes('Please enable JavaScript'),
      error.response?.data?.includes('captcha'),
      error.response?.data?.includes('unusual traffic'),
      error.response?.data?.includes('robot'),
      url.includes('twitter.com'),
      url.includes('facebook.com'),
      url.includes('instagram.com'),
      url.includes('linkedin.com'),
      url.includes('reddit.com'),
      url.includes('medium.com'),
    ];
    return indicators.some(indicator => indicator === true);
  }

  private isLowQualityContent(content: string, hadScripts: boolean = false): boolean {
    const trimmed = content.trim();
    if (trimmed === '') return true;

    // Explicit bot-detection / JS-required markers
    const badMarkers = [
      /please enable javascript/i,
      /you need to enable javascript/i,
      /enable javascript to (view|run|use)/i,
      /access denied/i,
      /403 forbidden/i,
      /captcha/i,
      /unusual traffic/i,
      /are you a robot/i,
      /this will only take a few seconds/i,
      /just a moment\.\.\./i,
      /checking your browser/i,
      /loading\.{2,}/i,
      /please wait\b.{0,40}(loading|verify)/i,
    ];
    if (badMarkers.some(re => re.test(trimmed))) return true;

    // Structural checks
    const words = trimmed.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;

    // Thin content on a JS-heavy page: axios likely missed the real content
    if (wordCount < 100 && hadScripts) return true;

    // Very thin content period
    if (wordCount < 30) return true;

    // Chrome-heavy content: repetitive nav/menu text has poor unique-word ratio
    if (wordCount >= 80) {
      const sample = words.slice(0, 400).map(w => w.toLowerCase());
      const uniqueRatio = new Set(sample).size / sample.length;
      if (uniqueRatio < 0.35) return true;
    }

    return false;
  }

  private getRandomHeaders(): Record<string, string> {
    const browsers = [
      {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-platform': '"Windows"',
      },
      {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-platform': '"macOS"',
      },
      {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-platform': '"Linux"',
      },
    ];
    const browser = browsers[Math.floor(Math.random() * browsers.length)];
    return {
      ...browser,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua-mobile': '?0',
    };
  }

  private getRandomUserAgent(): string {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:122.0) Gecko/20100101 Firefox/122.0',
    ];
    return userAgents[Math.floor(Math.random() * userAgents.length)];
  }

  private getRandomViewport(): { width: number; height: number } {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1440, height: 900 },
      { width: 1536, height: 864 },
      { width: 1280, height: 720 },
    ];
    return viewports[Math.floor(Math.random() * viewports.length)];
  }

  private getRandomTimezone(): string {
    const timezones = [
      'America/New_York',
      'America/Los_Angeles',
      'America/Chicago',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
    ];
    return timezones[Math.floor(Math.random() * timezones.length)];
  }

  async extractContentForResults(results: SearchResult[], targetCount: number = results.length, timeoutMs?: number): Promise<SearchResult[]> {
    const perExtractionTimeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 6000;
    const wallClockTimeout = Math.max(perExtractionTimeout + 2000, Math.floor(perExtractionTimeout * 1.35));
    const nonPdfResults = results.filter(result => !isPdfUrl(result.url));
    const resultsToProcess = nonPdfResults.slice(0, Math.min(targetCount * 2, 10));
    log.debug(`processing ${resultsToProcess.length} non-PDF results for ${targetCount} target (timeout=${perExtractionTimeout}ms, wall=${wallClockTimeout}ms)`);

    const extractionPromises = resultsToProcess.map(async (result): Promise<SearchResult> => {
      const controller = new AbortController();
      let timeoutHandle: NodeJS.Timeout | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            controller.abort();
            reject(new Error('Content extraction timeout'));
          }, wallClockTimeout);
        });
        const extractionPromise = this.extractContent({
          url: result.url,
          timeout: perExtractionTimeout,
          signal: controller.signal,
        });
        const content = await Promise.race([extractionPromise, timeoutPromise]);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const cleanedContent = cleanText(content, this.maxContentLength);
        log.debug(`extracted: ${result.url}`);
        return {
          ...result,
          fullContent: cleanedContent,
          contentPreview: getContentPreview(cleanedContent),
          wordCount: getWordCount(cleanedContent),
          timestamp: generateTimestamp(),
          fetchStatus: 'success' as const,
        };
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        controller.abort();
        log.debug(`failed to extract: ${result.url}`, error instanceof Error ? error.message : 'unknown');
        return {
          ...result,
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp: generateTimestamp(),
          fetchStatus: 'error' as const,
          error: this.getSpecificErrorMessage(error),
        };
      }
    });

    const allResults = await Promise.all(extractionPromises);
    const successfulResults = allResults.filter(r => r.fetchStatus === 'success');
    const failedResults = allResults.filter(r => r.fetchStatus === 'error');

    // Log failure summary at info level
    if (failedResults.length > 0) {
      const reasonCounts = new Map<string, number>();
      failedResults.forEach(r => {
        const reason = r.error || 'Unknown';
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      });
      const summary = Array.from(reasonCounts.entries())
        .map(([reason, count]) => count > 1 ? `${reason} (${count})` : reason)
        .join(', ');
      log.info(`extraction failures: ${summary}`);
    }

    const enhancedResults = [
      ...successfulResults.slice(0, targetCount),
      ...failedResults.slice(0, Math.max(0, targetCount - successfulResults.length)),
    ].slice(0, targetCount);

    log.info(`extracted ${successfulResults.length} successful/${failedResults.length} failed of ${resultsToProcess.length} processed`);
    return enhancedResults;
  }

  private parseContent(html: string): string {
    const $ = cheerio.load(html);

    // Extract main content BEFORE removing structural elements
    let mainContent = '';
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.mw-parser-output',
      '.post-content',
      '.entry-content',
      '.rf-content',
      '.section-content',
      '.article-content',
      '.story-content',
      '.news-content',
      '.main-content',
      '.page-content',
      '.text-content',
      '.body-content',
      '.content',
      '.copy',
      '.text',
      '.body',
    ];

    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      if ($content.length > 0) {
        mainContent = $content.text().trim();
        if (mainContent.length >= 50) break;
      }
    }

    // Remove decorative elements from full page
    $('script, style, noscript, iframe, img, video, audio, canvas, svg, object, embed, applet, form, input, textarea, select, button, label, fieldset, legend, optgroup, option').remove();
    $('nav, header, footer, .nav, .header, .footer, .sidebar, .menu, .breadcrumb, aside, .ad, .advertisement, .ads, .advertisement-container, .social-share, .share-buttons, .comments, .comment-section, .related-posts, .recommendations, .newsletter-signup, .cookie-notice, .privacy-notice, .terms-notice, .disclaimer, .legal, .copyright, .meta, .metadata, .author-info, .publish-date, .tags, .categories, .navigation, .pagination, .search-box, .search-form, .login-form, .signup-form, .newsletter, .popup, .modal, .overlay, .tooltip, .toolbar, .ribbon, .banner, .promo, .sponsored, .affiliate, .tracking, .analytics, .pixel, .beacon').remove();
    $('[class^="ad-"], [class*=" ad-"], [id^="ad-"], [id*="-ad"]').remove();
    $('[data-src*="image"], [data-src*="img"], [data-src*="photo"], [data-src*="picture"]').remove();
    $('[style*="background-image"]').remove();

    // Fallback to body text if no main content found
    if (!mainContent || mainContent.length < 50) {
      mainContent = $('body').text().trim();
    }

    const cleanedContent = this.cleanTextContent(mainContent);
    return cleanText(cleanedContent, this.maxContentLength);
  }

  private cleanTextContent(text: string): string {
    text = text.replace(/\s+/g, ' ');
    text = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '');
    text = text.replace(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)(\?[^\s]*)?/gi, '');
    text = text.replace(/\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)/gi, '');
    text = text.replace(/\n\s*\n/g, '\n');
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');

    // Strip common UI/chrome phrases that survive selector removal
    const chromePhrases = [
      /\b\d+\s*min(ute)?\s*read\b/gi,
      /\bshare\s+article\b/gi,
      /\barticle\s+outro\b/gi,
      /\btable of contents\b/gi,
      /\bsubscribe to (our )?newsletter\b/gi,
      /\bskip to (main )?content\b/gi,
      /\bcookie (settings|preferences|policy)\b/gi,
      /\bsign (up|in) (for|to)\b/gi,
    ];
    for (const re of chromePhrases) text = text.replace(re, '');
    text = text.replace(/\s+/g, ' ');

    return text.trim();
  }

  private getSpecificErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') return 'Request timeout';
      if (error.response?.status === 403) return '403 Forbidden - Access denied';
      if (error.response?.status === 404) return '404 Not found';
      if (error.message.includes('maxContentLength')) return 'Content too long';
      if (error.response?.status) return `HTTP ${error.response.status}: ${error.message}`;
      return `Network error: ${error.message}`;
    }
    return error instanceof Error ? error.message : 'Unknown error';
  }

  async closeAll(): Promise<void> {
    await this.browserPool.closeAll();
  }
}
