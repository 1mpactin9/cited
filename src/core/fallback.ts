import type { WebDataProvider, ApiResponse } from '../types.js';
import { getProvidersForTask, getProviderByName } from '../providers/index.js';

function shouldFallback(response: ApiResponse<unknown>): boolean {
  // If successful, don't fallback
  if (response.success) return false;

  // Check if this is a definite failure that should trigger fallback
  // Per documentation: fallback only on definite failure signals
  // We treat all failures as fallback eligible since providers already filter them
  return true;
}

export async function tryWithFallback<T>(
  task: string,
  forcedProvider: string | undefined,
  operation: (provider: WebDataProvider) => Promise<ApiResponse<T>>
): Promise<ApiResponse<T>> {
  let providers: WebDataProvider[];

  if (forcedProvider) {
    const provider = getProviderByName(forcedProvider);
    if (!provider) {
      return {
        success: false,
        error: `Provider "${forcedProvider}" not found`,
        provider: forcedProvider,
      };
    }
    if (!provider.hasApiKey) {
      return {
        success: false,
        error: `Provider "${forcedProvider}" has no API key configured`,
        provider: forcedProvider,
      };
    }
    providers = [provider];
  } else {
    providers = getProvidersForTask(task);
    if (providers.length === 0) {
      return {
        success: false,
        error: `No available providers for task "${task}" - check that at least one API key is set in environment variables`,
        provider: 'none',
      };
    }
  }

  let lastError: ApiResponse<T> | null = null;

  for (const provider of providers) {
    try {
      const result = await operation(provider);
      if (result.success) {
        return result;
      }
      if (shouldFallback(result)) {
        lastError = result;
        continue;
      }
      return result;
    } catch (error) {
      lastError = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        provider: provider.name,
      };
      continue;
    }
  }

  return lastError || {
    success: false,
    error: 'All providers failed',
    provider: 'none',
  };
}
