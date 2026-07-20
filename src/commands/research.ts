import type { ApiResponse, CommandOptions } from '../types.js';
import { tryWithFallback } from '../core/fallback.js';

export async function handleResearch(
  query: string,
  options: CommandOptions
): Promise<ApiResponse<string>> {
  return tryWithFallback('research', options.provider, (provider) => {
    if (provider.research) {
      return provider.research(query);
    }
    // Fallback to search if research not supported
    if (provider.search) {
      return provider.search(query).then((result) => {
        if (result.success && result.data) {
          const synthesized = result.data
            .map((r: any) => `## ${r.title}\n${r.url}\n\n${r.content}`)
            .join('\n\n---\n\n');
          return {
            success: true,
            data: synthesized,
            provider: result.provider,
          };
        }
        return {
          success: false,
          error: result.error || 'Search failed',
          provider: result.provider,
        };
      });
    }
    return Promise.resolve({
      success: false,
      error: 'Provider does not support research',
      provider: provider.name,
    });
  });
}
