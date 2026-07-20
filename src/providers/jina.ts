import type {
  WebDataProvider,
  SearchResult,
  ApiResponse,
  ExtractedContent,
} from '../types.js';
import { wrappedFetch } from '../core/fetch.js';

const API_KEY = process.env.JINA_API_KEY;
const READER_BASE = 'https://r.jina.ai';
const SEARCH_BASE = 'https://s.jina.ai';

export class JinaProvider implements WebDataProvider {
  name = 'jina';
  hasApiKey = true; // Jina allows keyless access for Reader

  async fetch(url: string): Promise<ApiResponse<string>> {
    try {
      const targetUrl = `${READER_BASE}/${url}`;
      const headers: Record<string, string> = {
        'Accept': 'text/markdown',
      };
      if (API_KEY) {
        headers['Authorization'] = `Bearer ${API_KEY}`;
      }
      headers['x-respond-with'] = 'readerlm-v2';

      const response = await wrappedFetch(targetUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const content = await response.text();
      if (!content || content.trim().length === 0) {
        return {
          success: false,
          error: 'Empty response from Jina',
          provider: this.name,
        };
      }

      return { success: true, data: content, provider: this.name };
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
    const urlArray = Array.isArray(urls) ? urls : [urls];
    const results: ExtractedContent[] = [];

    for (const url of urlArray) {
      const result = await this.fetch(url);
      if (result.success && result.data) {
        results.push({
          url,
          content: result.data,
        });
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

  async search(
    query: string
  ): Promise<ApiResponse<SearchResult[]>> {
    // Jina Search requires API key
    if (!API_KEY) {
      return {
        success: false,
        error: 'JINA_API_KEY required for search',
        provider: this.name,
      };
    }

    try {
      const encodedQuery = encodeURIComponent(query);
      const targetUrl = `${SEARCH_BASE}/?q=${encodedQuery}`;
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${API_KEY}`,
        'Accept': 'application/json',
      };

      const response = await wrappedFetch(targetUrl, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
          provider: this.name,
        };
      }

      const data = await response.json();
      const results: SearchResult[] = (data.data || []).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        content: r.content || '',
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

export default new JinaProvider();
