import type { CrawlResult, ApiResponse, CommandOptions } from '../types.js';
import { tryWithFallback } from '../core/fallback.js';

export async function handleCrawl(
  url: string,
  options: CommandOptions
): Promise<ApiResponse<CrawlResult[]>> {
  return tryWithFallback('crawl', options.provider, (provider) => {
    if (!provider.crawl) {
      return Promise.resolve({
        success: false,
        error: 'Provider does not support crawl',
        provider: provider.name,
      });
    }
    return provider.crawl(url);
  });
}
