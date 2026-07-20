import type { ExtractedContent, ApiResponse, CommandOptions } from '../types.js';
import { tryWithFallback } from '../core/fallback.js';

export async function handleExtract(
  url: string,
  options: CommandOptions
): Promise<ApiResponse<ExtractedContent[]>> {
  return tryWithFallback('extract', options.provider, (provider) => {
    if (!provider.extract) {
      return Promise.resolve({
        success: false,
        error: 'Provider does not support extract',
        provider: provider.name,
      });
    }
    return provider.extract(url);
  });
}
