export interface SearchResult {
  title: string;
  url: string;
  description: string;
  fullContent: string;
  contentPreview: string;
  wordCount: number;
  timestamp: string;
  fetchStatus: 'success' | 'error' | 'timeout';
  error?: string;
}

export interface SearchOptions {
  query: string;
  numResults?: number;
  timeout?: number;
  engine?: string;
}

export interface ContentExtractionOptions {
  url: string;
  timeout?: number;
  maxContentLength?: number;
  signal?: AbortSignal;
}

export interface WebSearchToolInput {
  query: string;
  limit?: number;
  includeContent?: boolean;
  maxContentLength?: number;
  engine?: string;
  timeout?: number;
}

export interface WebSearchToolOutput {
  results: SearchResult[];
  total_results: number;
  search_time_ms: number;
  query: string;
  status?: string;
}

export interface SearchResultWithMetadata {
  results: SearchResult[];
  engine: string;
}
