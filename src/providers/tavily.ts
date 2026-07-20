import type {
  WebDataProvider,
  SearchResult,
  ApiResponse,
  ExtractedContent,
  CrawlResult,
  SearchOptions,
  ExtractOptions,
  CrawlOptions,
} from '../types.js';
import { wrappedFetch, isFallbackEligible, FetchError } from '../core/fetch.js';

const API_KEY = process.env.TAVILY_API_KEY;
const BASE_URL = 'https://api.tavily.com';

export class TavilyProvider implements WebDataProvider {
  name = 'tavily';
  hasApiKey = !!API_KEY;

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<ApiResponse<SearchResult[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'TAVILY_API_KEY not set', provider: this.name };
    }

    try {
      const body = {
        query,
        max_results: options.maxResults ?? 5,
        search_depth: options.searchDepth ?? 'basic',
        include_domains: options.includeDomains,
        exclude_domains: options.excludeDomains,
      };

      const response = await wrappedFetch(`${BASE_URL}/search`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const fallback = isFallbackEligible(response.status);
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const data = await response.json();
      const results: SearchResult[] = (data.results || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
        score: r.score,
      }));

      return { success: true, data: results, provider: this.name };
    } catch (error: unknown) {
      const fallback = error instanceof FetchError && error.isFallbackEligible;
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.name,
      };
    }
  }

  async extract(
    urls: string | string[],
    options: ExtractOptions = {}
  ): Promise<ApiResponse<ExtractedContent[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'TAVILY_API_KEY not set', provider: this.name };
    }

    try {
      const body = {
        urls: Array.isArray(urls) ? urls : [urls],
        extract_depth: options.extractDepth ?? 'basic',
        format: options.format ?? 'markdown',
        query: options.query,
      };

      const response = await wrappedFetch(`${BASE_URL}/extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const data = await response.json();
      const results: ExtractedContent[] = (data.results || []).map((r: any) => ({
        url: r.url || '',
        content: r.raw_content || '',
      }));

      return { success: true, data: results, provider: this.name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.name,
      };
    }
  }

  async crawl(
    url: string,
    _options: CrawlOptions = {}
  ): Promise<ApiResponse<CrawlResult[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'TAVILY_API_KEY not set', provider: this.name };
    }

    // Tavily map endpoint returns URLs, we can treat that as crawl result
    try {
      const body = { url };
      const response = await wrappedFetch(`${BASE_URL}/map`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const data = await response.json();
      const results: CrawlResult[] = (data.urls || []).map((u: string) => ({
        url: u,
      }));

      return { success: true, data: results, provider: this.name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.name,
      };
    }
  }

  async research(
    query: string,
    options: { model?: 'mini' | 'pro' } = {}
  ): Promise<ApiResponse<string>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'TAVILY_API_KEY not set', provider: this.name };
    }

    try {
      const body = {
        query,
        model: options.model ?? 'mini',
      };

      const response = await wrappedFetch(`${BASE_URL}/research`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const data = await response.json();
      return { success: true, data: data.report || '', provider: this.name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: this.name,
      };
    }
  }
}

export default new TavilyProvider();
