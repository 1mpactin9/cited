export class FetchError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly isFallbackEligible = false
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

export async function wrappedFetch(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new FetchError('Request timed out', undefined, true);
    }
    throw new FetchError(
      error instanceof Error ? error.message : 'Network error',
      undefined,
      true
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isFallbackEligible(statusCode: number): boolean {
  // Status codes that trigger fallback per documentation
  const fallbackCodes = new Set([
    402, // Payment required (Firecrawl out of credits)
    429, // Rate limit exceeded (all providers)
    432, // Plan limit exceeded (Tavily)
    433, // Pay-as-you-go limit exceeded (Tavily)
  ]);
  if (fallbackCodes.has(statusCode)) return true;
  if (statusCode >= 500) return true; // Server errors
  return false;
}
