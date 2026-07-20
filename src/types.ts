export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
}

export interface ExtractedContent {
  url: string;
  title?: string;
  content: string;
  author?: string;
  publishedDate?: string;
}

export interface CrawlResult {
  url: string;
  title?: string;
  content?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  provider: string;
}

export interface WebDataProvider {
  name: string;
  hasApiKey: boolean;

  search?(query: string, options?: SearchOptions): Promise<ApiResponse<SearchResult[]>>;
  extract?(urls: string | string[], options?: ExtractOptions): Promise<ApiResponse<ExtractedContent[]>>;
  fetch?(url: string): Promise<ApiResponse<string>>;
  crawl?(url: string, options?: CrawlOptions): Promise<ApiResponse<CrawlResult[]>>;
  research?(query: string, options?: ResearchOptions): Promise<ApiResponse<string>>;
}

export interface SearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

export interface ExtractOptions {
  query?: string;
  extractDepth?: 'basic' | 'advanced';
  format?: 'markdown' | 'text';
}

export interface CrawlOptions {
  maxPages?: number;
  extractContent?: boolean;
}

export interface ResearchOptions {
  model?: 'mini' | 'pro';
}

export interface CommandOptions {
  provider?: string;
  output?: 'json' | 'text';
}

export type TaskType = 'search' | 'fetch' | 'extract' | 'crawl' | 'research';
