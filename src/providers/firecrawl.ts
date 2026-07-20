import type {
  WebDataProvider,
  SearchResult,
  ApiResponse,
  ExtractedContent,
  CrawlResult,
  SearchOptions,
} from '../types.js';
import { wrappedFetch, isFallbackEligible } from '../core/fetch.js';

const API_KEY = process.env.FIRECRAWL_API_KEY;
const BASE_URL = 'https://api.firecrawl.dev/v2';

export class FirecrawlProvider implements WebDataProvider {
  name = 'firecrawl';
  hasApiKey = !!API_KEY;

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<ApiResponse<SearchResult[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'FIRECRAWL_API_KEY not set', provider: this.name };
    }

    try {
      const body = {
        query,
        limit: options.maxResults ?? 10,
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
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const data = await response.json();
      const results: SearchResult[] = (data.data?.web || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.markdown || r.description || '',
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

  async extract(
    urls: string | string[]
  ): Promise<ApiResponse<ExtractedContent[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'FIRECRAWL_API_KEY not set', provider: this.name };
    }

    const urlArray = Array.isArray(urls) ? urls : [urls];
    const results: ExtractedContent[] = [];

    for (const url of urlArray) {
      try {
        const body = {
          url,
          formats: ['markdown'],
          onlyMainContent: true,
        };

        const response = await wrappedFetch(`${BASE_URL}/scrape`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        results.push({
          url,
          title: data.data?.metadata?.title,
          content: data.data?.markdown || '',
        });
      } catch {
        continue;
      }
    }

    if (results.length === 0 && urlArray.length > 0) {
      return {
        success: false,
        error: 'All URLs failed extraction',
        provider: this.name,
      };
    }

    return { success: true, data: results, provider: this.name };
  }

  async crawl(
    url: string
  ): Promise<ApiResponse<CrawlResult[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'FIRECRAWL_API_KEY not set', provider: this.name };
    }

    try {
      // First use map to get all URLs
      const mapBody = { url };
      const mapResponse = await wrappedFetch(`${BASE_URL}/map`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(mapBody),
      });

      if (!mapResponse.ok) {
        return {
          success: false,
          error: `HTTP ${mapResponse.status}: ${mapResponse.statusText}`,
          provider: this.name,
        };
      }

      const mapData = await mapResponse.json();
      const results: CrawlResult[] = (mapData.links || []).map((u: string) => ({
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
}

export default new FirecrawlProvider();
