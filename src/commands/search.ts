import type { SearchResult, ApiResponse, CommandOptions } from '../types.js';
import { tryWithFallback } from '../core/fallback.js';

export async function handleSearch(
  query: string,
  options: CommandOptions
): Promise<ApiResponse<SearchResult[]>> {
  return tryWithFallback('search', options.provider, (provider) => {
    if (!provider.search) {
      return Promise.resolve({
        success: false,
        error: 'Provider does not support search',
        provider: provider.name,
      });
    }
    return provider.search(query);
  });
}
