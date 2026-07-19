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
    const { url } = options;
    log.debug(`extracting: ${url}`);
    try {
      const content = await this.extractWithAxios(options);
      log.debug(`axios extracted ${content.length} chars: ${url}`);
      return content;
    } catch (error) {
      log.debug(`axios failed: ${url}`, error instanceof Error ? error.message : 'unknown');
      if (this.shouldUseBrowser(error, url)) {
        log.debug(`falling back to headless browser: ${url}`);
        try {
          const content = await this.extractWithBrowser(options);
          log.debug(`browser extracted ${content.length} chars: ${url}`);
          return content;
        } catch (browserError) {
          log.error(`browser extraction also failed: ${url}`, browserError);
          throw new Error(`Both axios and browser extraction failed for ${url}`);
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

    let content = this.parseContent(response.data);
    if (maxContentLength && content.length > maxContentLength) {
      content = content.substring(0, maxContentLength);
    }
    if (this.isLowQualityContent(content)) {
      throw new Error('Low quality content detected - likely bot detection');
    }
    return content;
  }

  private async extractWithBrowser(options: ContentExtractionOptions): Promise<string> {
    const { url, timeout = this.defaultTimeout } = options;
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
      const content = this.parseContent(html);
      await context.close();
      return content;
    } catch (error) {
      log.error(`browser extraction failed: ${url}`, error);
      try { await context.close(); } catch { /* context may already be closed */ }
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

  private isLowQualityContent(content: string): boolean {
    const lowQualityIndicators = [
      content.length < 100,
      content.includes('Please enable JavaScript'),
      content.includes('Access Denied'),
      content.includes('403 Forbidden'),
      content.includes('captcha'),
      content.includes('unusual traffic'),
      content.includes('robot'),
      content.trim() === '',
    ];
    return lowQualityIndicators.some(indicator => indicator === true);
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

  async extractContentForResults(results: SearchResult[], targetCount: number = results.length): Promise<SearchResult[]> {
    const nonPdfResults = results.filter(result => !isPdfUrl(result.url));
    const resultsToProcess = nonPdfResults.slice(0, Math.min(targetCount * 2, 10));
    log.debug(`processing ${resultsToProcess.length} non-PDF results for ${targetCount} target`);

    const extractionPromises = resultsToProcess.map(async (result): Promise<SearchResult> => {
      try {
        const extractionPromise = this.extractContent({ url: result.url, timeout: 6000 });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Content extraction timeout')), 8000);
        });
        const content = await Promise.race([extractionPromise, timeoutPromise]);
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

    const enhancedResults = [
      ...successfulResults.slice(0, targetCount),
      ...failedResults.slice(0, Math.max(0, targetCount - successfulResults.length)),
    ].slice(0, targetCount);

    log.info(`extracted ${successfulResults.length} successful/${failedResults.length} failed of ${resultsToProcess.length} processed`);
    return enhancedResults;
  }

  private parseContent(html: string): string {
    const $ = cheerio.load(html);

    $('script, style, noscript, iframe, img, video, audio, canvas, svg, object, embed, applet, form, input, textarea, select, button, label, fieldset, legend, optgroup, option').remove();
    $('nav, header, footer, .nav, .header, .footer, .sidebar, .menu, .breadcrumb, aside, .ad, .advertisement, .ads, .advertisement-container, .social-share, .share-buttons, .comments, .comment-section, .related-posts, .recommendations, .newsletter-signup, .cookie-notice, .privacy-notice, .terms-notice, .disclaimer, .legal, .copyright, .meta, .metadata, .author-info, .publish-date, .tags, .categories, .navigation, .pagination, .search-box, .search-form, .login-form, .signup-form, .newsletter, .popup, .modal, .overlay, .tooltip, .toolbar, .ribbon, .banner, .promo, .sponsored, .affiliate, .tracking, .analytics, .pixel, .beacon').remove();
    $('[class*="ad"], [class*="ads"], [class*="advertisement"], [class*="tracking"], [class*="analytics"], [class*="pixel"], [class*="beacon"], [class*="sponsored"], [class*="affiliate"], [class*="promo"], [class*="banner"], [class*="popup"], [class*="modal"], [class*="overlay"], [class*="tooltip"], [class*="toolbar"], [class*="ribbon"]').remove();
    $('[id*="ad"], [id*="ads"], [id*="advertisement"], [id*="tracking"], [id*="analytics"], [id*="pixel"], [id*="beacon"], [id*="sponsored"], [id*="affiliate"], [id*="promo"], [id*="banner"], [id*="popup"], [id*="modal"], [id*="overlay"], [id*="tooltip"], [id*="toolbar"], [id*="ribbon"], [id*="sidebar"], [id*="navigation"], [id*="menu"], [id*="footer"], [id*="header"]').remove();
    $('picture, source, figure, figcaption, .image, .img, .photo, .picture, .media, .gallery, .slideshow, .carousel').remove();
    $('[data-src*="image"], [data-src*="img"], [data-src*="photo"], [data-src*="picture"]').remove();
    $('[style*="background-image"]').remove();

    $('*').each(function () {
      const $this = $(this);
      if ($this.children().length === 0 && $this.text().trim() === '') {
        $this.remove();
      }
    });

    let mainContent = '';
    const contentSelectors = [
      'article', 'main', '[role="main"]', '.content', '.post-content', '.entry-content',
      '.article-content', '.story-content', '.news-content', '.main-content', '.page-content',
      '.text-content', '.body-content', '.copy', '.text', '.body',
    ];

    for (const selector of contentSelectors) {
      const $content = $(selector).first();
      if ($content.length > 0) {
        mainContent = $content.text().trim();
        if (mainContent.length > 100) break;
      }
    }

    if (!mainContent || mainContent.length < 100) {
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
    text = text.replace(/image|img|photo|picture|gallery|slideshow|carousel/gi, '');
    text = text.replace(/click to enlarge|click for full size|view larger|download image/gi, '');
    text = text.replace(/cookie|privacy|terms|conditions|disclaimer|legal|copyright|all rights reserved/gi, '');
    text = text.replace(/\n\s*\n/g, '\n');
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/\r/g, '\n');
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
