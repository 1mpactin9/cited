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
    const { query, numResults = 5, timeout = 10000, engine } = options;
    const sanitizedQuery = sanitizeQuery(query);

    log.info(`searching: "${sanitizedQuery}"${engine ? ` (forced: ${engine})` : ''}`);

    try {
      return await this.rateLimiter.execute(async () => {
        const enableQualityCheck = process.env.ENABLE_RELEVANCE_CHECKING !== 'false';
        const qualityThreshold = parseFloat(process.env.RELEVANCE_THRESHOLD || '0.3');
        const forceMultiEngine = process.env.FORCE_MULTI_ENGINE_SEARCH === 'true';

        const allApproaches = [
          { method: this.tryBrowserBingSearch.bind(this), name: 'Browser Bing', key: 'bing' },
          { method: this.tryBrowserBraveSearch.bind(this), name: 'Browser Brave', key: 'brave' },
          { method: this.tryDuckDuckGoSearch.bind(this), name: 'Axios DuckDuckGo', key: 'duckduckgo' },
        ];
        const approaches = engine
          ? allApproaches.filter(a => a.key === engine)
          : allApproaches;
        if (engine && approaches.length === 0) {
          throw new Error(`Unknown engine: ${engine}`);
        }

        let bestResults: SearchResult[] = [];
        let bestEngine = 'None';
        let bestQuality = 0;

        for (let i = 0; i < approaches.length; i++) {
          const approach = approaches[i];
          try {
            log.debug(`attempting ${approach.name} (${i + 1}/${approaches.length})`);
            const approachTimeout = Math.max(Math.floor(timeout / 3), 4000);
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
            log.failure(`${approach.name} approach failed`, error instanceof Error ? error.message : error);
          }
        }

        if (bestResults.length === 0) {
          log.warn('all approaches failed, returning empty results');
          return { results: [], engine: 'None' };
        } else {
          log.info(`using best results from ${bestEngine} (quality: ${bestQuality.toFixed(2)})`);
          return { results: bestResults, engine: bestEngine };
        }
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
        const { chromium } = await import('playwright');
        browser = await chromium.launch({
          headless: true,
          args: [
            '--headless=new',
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
        });
        log.debug(`brave attempt ${attempt}/2`);
        return await this.tryBrowserBraveSearchInternal(browser, query, numResults, Math.min(timeout / 2, 6000));
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
          headless: true,
          args: [
            '--headless=new',
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

        // Skip sponsored/ad results
        const dt = $element.attr('data-type') || '';
        if (dt === 'sponsored' || dt === 'ad') return;
        if ($element.attr('class')?.toLowerCase().includes('sponsored') ||
            $element.attr('class')?.toLowerCase().includes('ad-')) return;

        // Drop breadcrumb/favicon chrome before scraping text, so title/snippet lookups don't pick them up
        $element.find('.snippet-url, .site-name-wrapper, .favicon, .favicon-wrapper, cite').remove();

        // Title: Brave's current DOM uses .title.search-snippet-title; older classes as fallback
        let title = '';
        let url = '';
        const $titleLink = $element.find('a').filter((_i, a) => {
          const href = $(a).attr('href') || '';
          return /^https?:\/\//i.test(href) && $(a).find('.title, .search-snippet-title').length > 0;
        }).first();
        if ($titleLink.length) {
          url = $titleLink.attr('href') || '';
          title = $titleLink.find('.title, .search-snippet-title').first().text().trim();
        }
        if (!title) {
          const titleSelectors = ['.title', '.search-snippet-title', 'h2 a', '.result-title a', 'a[href*="://"]'];
          for (const s of titleSelectors) {
            const $t = $element.find(s).first();
            if ($t.length) {
              title = $t.text().trim();
              if (!url) {
                const $a = $t.is('a') ? $t : $t.closest('a');
                if ($a.length) url = $a.attr('href') || '';
              }
              if (title && url) break;
            }
          }
        }
        title = title.replace(/\s+/g, ' ').trim();

        // Skip titles that indicate ads
        if (title.match(/^(Sponsored|Ad|Promoted)/i)) return;

        // Snippet: prefer explicit snippet containers, filter out breadcrumb-shaped text
        const snippetSelectors = [
          '.snippet-description',
          '.snippet-content .desktop-default-regular',
          '.desktop-default-regular.line-clamp-2',
          '.desktop-default-regular',
          '.result-snippet',
          '.description',
          '.desc',
        ];
        let snippet = '';
        for (const snippetSelector of snippetSelectors) {
          const $snippetElement = $element.find(snippetSelector).first();
          if ($snippetElement.length) {
            const candidate = $snippetElement.text().trim().replace(/\s+/g, ' ');
            if (this.isUsableSnippet(candidate)) { snippet = candidate; break; }
          }
        }
        if (!snippet) {
          // Last resort: longest paragraph-shaped block that passes the usable check
          let longest = '';
          $element.find('p, div').each((_i, el) => {
            const t = $(el).text().trim().replace(/\s+/g, ' ');
            if (t.length > longest.length && t.length < 500 && this.isUsableSnippet(t)) longest = t;
          });
          if (longest.length >= 40) snippet = longest;
        }

        if (title && url && this.isValidSearchUrl(url)) {
          results.push({
            title,
            url: this.cleanBraveUrl(url),
            description: snippet,
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
      log.warn('Bing returned bot detection or access denied page');
    }

    const resultSelectors = ['.b_algo', '.b_result'];
    for (const selector of resultSelectors) {
      if (results.length >= maxResults) break;
      const elements = $(selector).not('.b_ad');
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

        // Skip sponsored/ad results
        if (title.match(/^(Sponsored|Ad|Promoted)/i)) return;
        if (url.includes('bing.com/ck/') || url.includes('u.bing.net')) return;

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
            description: snippet,
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

      // Skip sponsored/ad results
      if ($element.find('.result-header--sentinel').length > 0 ||
          $element.attr('class')?.toLowerCase().includes('ad')) return;

      const $titleElement = $element.find('.result__title a');
      const title = $titleElement.text().trim();
      const url = $titleElement.attr('href');
      let snippet = $element.find('.result__snippet').text().trim();
      if (!snippet) snippet = $element.find('.result__body').text().trim();
      snippet = snippet.replace(/\s+/g, ' ');
      if (title && url) {
        results.push({
          title,
          url: this.cleanDuckDuckGoUrl(url),
          description: snippet,
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

  private isUsableSnippet(text: string): boolean {
    if (text.length < 20) return false;
    // Pure URL / hostname
    if (/^https?:\/\//i.test(text)) return false;
    if (/^[\w.-]+\.[a-z]{2,}\s*(›|»|\/|$)/i.test(text) && text.split(/\s+/).length < 8) return false;
    // Breadcrumb-only: has › or » and no sentence-ending punctuation in first 200 chars
    const head = text.slice(0, 200);
    if (/[›»]/.test(head) && !/[.!?]\s/.test(head)) return false;
    // Timestamp-only snippets ("3 hours ago", "2 min read")
    if (/^\d+\s*(min|sec|hour|day|week|month|year)/i.test(text)) return false;
    return true;
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
