import type { ApiResponse, CommandOptions } from '../types.js';
import { tryWithFallback } from '../core/fallback.js';

export async function handleFetch(
  url: string,
  options: CommandOptions
): Promise<ApiResponse<string>> {
  return tryWithFallback('fetch', options.provider, (provider) => {
    if (provider.fetch) {
      return provider.fetch(url);
    }
    if (provider.extract) {
      return provider.extract(url).then((result) => {
        if (result.success && result.data && result.data.length > 0) {
          return {
            success: true,
            data: result.data[0].content,
            provider: result.provider,
          };
        }
        return {
          success: false,
          error: result.error || 'Extraction failed',
          provider: result.provider,
        };
      });
    }
    return Promise.resolve({
      success: false,
      error: 'Provider does not support fetch',
      provider: provider.name,
    });
  });
}
