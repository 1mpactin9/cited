import type {
  WebDataProvider,
  SearchResult,
  ApiResponse,
  ExtractedContent,
  SearchOptions,
} from '../types.js';
import { wrappedFetch, isFallbackEligible } from '../core/fetch.js';

const API_KEY = process.env.EXA_API_KEY;
const BASE_URL = 'https://api.exa.ai';

export class ExaProvider implements WebDataProvider {
  name = 'exa';
  hasApiKey = !!API_KEY;

  async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<ApiResponse<SearchResult[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'EXA_API_KEY not set', provider: this.name };
    }

    try {
      const body = {
        query,
        numResults: options.maxResults ?? 10,
        contents: {
          highlights: true,
        },
      };

      const response = await wrappedFetch(`${BASE_URL}/search`, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY!,
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
      const results: SearchResult[] = (data.results || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.highlights ? r.highlights.join(' ') : r.text || '',
        score: r.score,
        publishedDate: r.publishedDate,
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
    urls: string | string[],
  ): Promise<ApiResponse<ExtractedContent[]>> {
    if (!this.hasApiKey) {
      return { success: false, error: 'EXA_API_KEY not set', provider: this.name };
    }

    try {
      const urlArray = Array.isArray(urls) ? urls : [urls];
      const body = {
        urls: urlArray,
        text: true,
      };

      const response = await wrappedFetch(`${BASE_URL}/contents`, {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY!,
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
      const results: ExtractedContent[] = [];

      for (let i = 0; i < (data.results || []).length; i++) {
        const r = data.results[i];
        const status = data.statuses?.[i];
        if (status?.status === 'error') continue;
        results.push({
          url: urlArray[i],
          content: r.text || '',
          title: r.title,
          publishedDate: r.publishedDate,
        });
      }

      // Check if all failed - trigger fallback
      if (results.length === 0 && urlArray.length > 0) {
        return {
          success: false,
          error: 'All URLs failed extraction',
          provider: this.name,
        };
      }

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

export default new ExaProvider();
