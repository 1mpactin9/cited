import axios from 'axios';
import * as cheerio from 'cheerio';
import { SearchOptions, SearchResult, SearchResultWithMetadata } from './types.js';
import { generateTimestamp, sanitizeQuery } from './utils.js';
import { RateLimiter } from './rate-limiter.js';
import { createLogger } from './logger.js';

const log = createLogger('SearchEngine');

const BING_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const DDG_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export class SearchEngine {
  private readonly rateLimiter: RateLimiter;

  constructor() {
    this.rateLimiter = new RateLimiter(10);
  }

  async search(options: SearchOptions): Promise<SearchResultWithMetadata> {
    const { query, numResults = 5, timeout = 10000 } = options;
    const sanitizedQuery = sanitizeQuery(query);

    log.info(`searching: "${sanitizedQuery}"`);

    try {
      return await this.rateLimiter.execute(async () => {
        const enableQualityCheck = process.env.ENABLE_RELEVANCE_CHECKING !== 'false';
        const qualityThreshold = parseFloat(process.env.RELEVANCE_THRESHOLD || '0.3');
        const forceMultiEngine = process.env.FORCE_MULTI_ENGINE_SEARCH === 'true';

        const approaches = [
          { method: this.tryBrowserBingSearch.bind(this), name: 'Browser Bing' },
          { method: this.tryBrowserBraveSearch.bind(this), name: 'Browser Brave' },
          { method: this.tryDuckDuckGoSearch.bind(this), name: 'Axios DuckDuckGo' },
        ];

        let bestResults: SearchResult[] = [];
        let bestEngine = 'None';
        let bestQuality = 0;

        for (let i = 0; i < approaches.length; i++) {
          const approach = approaches[i];
          try {
            log.debug(`attempting ${approach.name} (${i + 1}/${approaches.length})`);
            const approachTimeout = Math.min(timeout / 3, 4000);
            const results = await approach.method(sanitizedQuery, numResults, approachTimeout);
            if (results.length === 0) continue;

            log.debug(`${approach.name} returned ${results.length} results`);
            const qualityScore = enableQualityCheck ? this.assessResultQuality(results, sanitizedQuery) : 1.0;
            log.debug(`${approach.name} quality: ${qualityScore.toFixed(2)}`);

            if (qualityScore > bestQuality) {
              bestResults = results;
              bestEngine = approach.name;
              bestQuality = qualityScore;
            }

            if (qualityScore >= 0.8 && !forceMultiEngine) {
              log.debug(`${approach.name} excellent quality, returning`);
              return { results, engine: approach.name };
            }
            if (qualityScore >= qualityThreshold && approach.name !== 'Browser Bing' && !forceMultiEngine) {
              log.debug(`${approach.name} acceptable quality, returning`);
              return { results, engine: approach.name };
            }
            if (i === approaches.length - 1 && bestResults.length > 0) {
              log.debug(`using best results from ${bestEngine} (quality: ${bestQuality.toFixed(2)})`);
              return { results: bestResults, engine: bestEngine };
            }
          } catch (error) {
            log.debug(`${approach.name} approach failed`, error instanceof Error ? error.message : error);
          }
        }

        log.warn('all approaches failed, returning empty results');
        return { results: [], engine: 'None' };
      });
    } catch (error) {
      log.error('search error', error);
      throw new Error(`Failed to perform search: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async tryBrowserBraveSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let browser;
      try {
        const { firefox } = await import('playwright');
        browser = await firefox.launch({
          headless: process.env.BROWSER_HEADLESS !== 'false',
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        log.debug(`brave attempt ${attempt}/2`);
        return await this.tryBrowserBraveSearchInternal(browser, query, numResults, timeout);
      } catch (error) {
        log.debug(`brave attempt ${attempt}/2 failed`, error instanceof Error ? error.message : error);
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      } finally {
        if (browser) {
          try { await browser.close(); } catch (error) { log.debug('error closing brave browser', error); }
        }
      }
    }
    throw new Error('All Brave search attempts failed');
  }

  private async tryBrowserBraveSearchInternal(browser: any, query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    if (!browser.isConnected()) throw new Error('Browser is not connected');
    const context = await browser.newContext({
      userAgent: BING_USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    try {
      const page = await context.newPage();
      const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
      log.debug(`brave navigating to: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout });
      try {
        await page.waitForSelector('[data-type="web"]', { timeout: 3000 });
      } catch {
        log.debug('brave results selector not found, proceeding anyway');
      }
      const html = await page.content();
      const results = this.parseBraveResults(html, numResults);
      log.debug(`brave parsed ${results.length} results`);
      return results;
    } finally {
      await context.close();
    }
  }

  private async tryBrowserBingSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      let browser;
      try {
        const { chromium } = await import('playwright');
        browser = await chromium.launch({
          headless: process.env.BROWSER_HEADLESS !== 'false',
          args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });
        log.debug(`bing attempt ${attempt}/2`);
        const results = await this.tryBrowserBingSearchInternal(browser, query, numResults, timeout);
        log.debug(`bing returned ${results.length} results`);
        return results;
      } catch (error) {
        log.debug(`bing attempt ${attempt}/2 failed`, error instanceof Error ? error.message : error);
        if (attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 500));
      } finally {
        if (browser) {
          try { await browser.close(); } catch (error) { log.debug('error closing bing browser', error); }
        }
      }
    }
    throw new Error('All Bing search attempts failed');
  }

  private async tryBrowserBingSearchInternal(browser: any, query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    if (!browser.isConnected()) throw new Error('Browser is not connected');
    const context = await browser.newContext({
      userAgent: BING_USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      colorScheme: 'light',
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    });
    const page = await context.newPage();
    try {
      try {
        log.debug('bing enhanced search (homepage -> form submission)');
        return await this.tryEnhancedBingSearch(page, query, numResults, timeout);
      } catch (enhancedError) {
        log.debug('bing enhanced failed, falling back to direct URL', enhancedError instanceof Error ? enhancedError.message : enhancedError);
        return await this.tryDirectBingSearch(page, query, numResults, timeout);
      }
    } finally {
      await context.close();
    }
  }

  private async tryEnhancedBingSearch(page: any, query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    await page.goto('https://www.bing.com', { waitUntil: 'domcontentloaded', timeout: timeout / 2 });
    await page.waitForTimeout(500);

    await page.waitForSelector('#sb_form_q', { timeout: 2000 });
    await page.fill('#sb_form_q', query);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout }),
      page.click('#search_icon'),
    ]);

    return this.parseBingPage(page, numResults);
  }

  private async tryDirectBingSearch(page: any, query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    const cvid = this.generateConversationId();
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(numResults, 10)}&form=QBLH&sp=-1&qs=n&cvid=${cvid}`;
    log.debug(`bing direct URL: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout });
    return this.parseBingPage(page, numResults);
  }

  private async parseBingPage(page: any, numResults: number): Promise<SearchResult[]> {
    try {
      await page.waitForSelector('.b_algo, .b_result', { timeout: 3000 });
    } catch {
      log.debug('bing results selector not found, proceeding anyway');
    }
    const html = await page.content();
    if (html.length < 10000) log.debug('bing HTML seems short, possible bot detection');
    const results = this.parseBingResults(html, numResults);
    if (results.length === 0) log.debug('bing parsed 0 results', html.substring(0, 500));
    return results;
  }

  private generateConversationId(): string {
    const chars = '0123456789ABCDEF';
    let cvid = '';
    for (let i = 0; i < 32; i++) {
      cvid += chars[Math.floor(Math.random() * chars.length)];
    }
    return cvid;
  }

  private async tryDuckDuckGoSearch(query: string, numResults: number, timeout: number): Promise<SearchResult[]> {
    log.debug('duckduckgo fallback');
    try {
      const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query },
        headers: {
          'User-Agent': DDG_USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
        timeout,
        validateStatus: (status: number) => status < 400,
      });
      const results = this.parseDuckDuckGoResults(response.data, numResults);
      log.debug(`duckduckgo parsed ${results.length} results`);
      return results;
    } catch {
      log.debug('duckduckgo search failed');
      throw new Error('DuckDuckGo search failed');
    }
  }

  private parseBraveResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    const resultSelectors = ['[data-type="web"]', '.result', '.fdb'];
    for (const selector of resultSelectors) {
      if (results.length >= maxResults) break;
      $(selector).each((_index, element) => {
        if (results.length >= maxResults) return false;
        const $element = $(element);

        const titleSelectors = ['.title a', 'h2 a', '.result-title a', 'a[href*="://"]', '.snippet-title a'];
        let title = '';
        let url = '';
        for (const titleSelector of titleSelectors) {
          const $titleElement = $element.find(titleSelector).first();
          if ($titleElement.length) {
            title = $titleElement.text().trim();
            url = $titleElement.attr('href') || '';
            if (title && url && url.startsWith('http')) break;
          }
        }

        if (!title) {
          const textContent = $element.text().trim();
          const lines = textContent.split('\n').filter(line => line.trim().length > 0);
          if (lines.length > 0) title = lines[0].trim();
        }

        const snippetSelectors = ['.snippet-content', '.snippet', '.description', 'p'];
        let snippet = '';
        for (const snippetSelector of snippetSelectors) {
          const $snippetElement = $element.find(snippetSelector).first();
          if ($snippetElement.length) {
            snippet = $snippetElement.text().trim();
            break;
          }
        }

        if (title && url && this.isValidSearchUrl(url)) {
          results.push({
            title,
            url: this.cleanBraveUrl(url),
            description: snippet || 'No description available',
            fullContent: '',
            contentPreview: '',
            wordCount: 0,
            timestamp,
            fetchStatus: 'success',
          });
        }
      });
    }
    return results;
  }

  private parseBingResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    const pageTitle = $('title').text();
    if (pageTitle.includes('Access Denied') || pageTitle.includes('blocked') || pageTitle.includes('captcha')) {
      log.debug('bing bot detection or access denied in page title');
    }

    const resultSelectors = ['.b_algo', '.b_result', '.b_card'];
    for (const selector of resultSelectors) {
      if (results.length >= maxResults) break;
      const elements = $(selector);
      if (elements.length === 0) continue;
      elements.each((_index, element) => {
        if (results.length >= maxResults) return false;
        const $element = $(element);

        const titleSelectors = ['h2 a', '.b_title a', 'a[data-seid]'];
        let title = '';
        let url = '';
        for (const titleSelector of titleSelectors) {
          const $titleElement = $element.find(titleSelector).first();
          if ($titleElement.length) {
            title = $titleElement.text().trim();
            url = $titleElement.attr('href') || '';
            break;
          }
        }

        const snippetSelectors = [
          '.b_caption p', '.b_snippet', '.b_descript', '.b_caption', '.b_caption > span',
          '.b_excerpt', 'p', '.b_algo_content p', '.b_algo_content', '.b_context',
        ];
        let snippet = '';
        for (const snippetSelector of snippetSelectors) {
          const $snippetElement = $element.find(snippetSelector).first();
          if ($snippetElement.length) {
            const candidateSnippet = $snippetElement.text().trim();
            if (candidateSnippet.length > 20 && !candidateSnippet.match(/^\d+\s*(min|sec|hour|day|week|month|year)/i)) {
              snippet = candidateSnippet;
              break;
            }
          }
        }

        if (title && url && this.isValidSearchUrl(url)) {
          results.push({
            title,
            url: this.cleanBingUrl(url),
            description: snippet || 'No description available',
            fullContent: '',
            contentPreview: '',
            wordCount: 0,
            timestamp,
            fetchStatus: 'success',
          });
        }
      });
    }
    return results;
  }

  private parseDuckDuckGoResults(html: string, maxResults: number): SearchResult[] {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const timestamp = generateTimestamp();

    $('.result').each((_index, element) => {
      if (results.length >= maxResults) return false;
      const $element = $(element);
      const $titleElement = $element.find('.result__title a');
      const title = $titleElement.text().trim();
      const url = $titleElement.attr('href');
      const snippet = $element.find('.result__snippet').text().trim();
      if (title && url) {
        results.push({
          title,
          url: this.cleanDuckDuckGoUrl(url),
          description: snippet || 'No description available',
          fullContent: '',
          contentPreview: '',
          wordCount: 0,
          timestamp,
          fetchStatus: 'success',
        });
      }
    });
    return results;
  }

  private isValidSearchUrl(url: string): boolean {
    return url.startsWith('/url?') ||
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('//') ||
      url.startsWith('/search?') ||
      url.startsWith('/') ||
      url.includes('google.com') ||
      url.length > 10;
  }

  private cleanBraveUrl(url: string): string {
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  private cleanBingUrl(url: string): string {
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  private cleanDuckDuckGoUrl(url: string): string {
    if (url.startsWith('//duckduckgo.com/l/')) {
      try {
        const urlParams = new URLSearchParams(url.substring(url.indexOf('?') + 1));
        const actualUrl = urlParams.get('uddg');
        if (actualUrl) return decodeURIComponent(actualUrl);
      } catch {
        log.debug('failed to decode duckduckgo url', url);
      }
    }
    if (url.startsWith('//')) return 'https:' + url;
    return url;
  }

  private assessResultQuality(results: SearchResult[], originalQuery: string): number {
    if (results.length === 0) return 0;

    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'group', 'members']);
    const queryWords = originalQuery.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word));

    if (queryWords.length === 0) return 0.5;

    let totalScore = 0;
    for (const result of results) {
      const combinedText = `${result.title} ${result.description} ${result.url}`.toLowerCase();

      let keywordMatches = 0;
      for (const keyword of queryWords) {
        if (combinedText.includes(keyword)) keywordMatches++;
      }

      let phraseMatches = 0;
      if (queryWords.length >= 2) {
        const queryPhrases: string[] = [];
        for (let i = 0; i < queryWords.length - 1; i++) {
          queryPhrases.push(queryWords.slice(i, i + 2).join(' '));
        }
        if (queryWords.length >= 3) queryPhrases.push(queryWords.slice(0, 3).join(' '));
        for (const phrase of queryPhrases) {
          if (combinedText.includes(phrase)) phraseMatches++;
        }
      }

      const keywordRatio = keywordMatches / queryWords.length;
      const phraseBonus = phraseMatches * 0.3;
      totalScore += Math.min(1.0, keywordRatio + phraseBonus);
    }

    return totalScore / results.length;
  }

  async closeAll(): Promise<void> {}
}
