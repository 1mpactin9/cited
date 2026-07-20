import type { WebDataProvider } from '../types.js';
import tavily from './tavily.js';
import exa from './exa.js';
import firecrawl from './firecrawl.js';
import jina from './jina.js';

export { tavily, exa, firecrawl, jina };
export const allProviders = [tavily, firecrawl, exa, jina];

export function getProviderByName(name: string): WebDataProvider | undefined {
  return allProviders.find(p => p.name === name.toLowerCase());
}

// Get providers in fallback order per task
export function getProvidersForTask(task: string): WebDataProvider[] {
  const availableProviders = allProviders.filter(p => p.hasApiKey);

  switch (task) {
    case 'search':
      // General search: Tavily → Firecrawl → Exa
      return [
        ...availableProviders.filter(p => p.name === 'tavily'),
        ...availableProviders.filter(p => p.name === 'firecrawl'),
        ...availableProviders.filter(p => p.name === 'exa'),
      ].filter(p => p.search) as WebDataProvider[];

    case 'fetch':
    case 'extract':
      // Single-page extract: Jina → Firecrawl → Exa
      return [
        ...availableProviders.filter(p => p.name === 'jina'),
        ...availableProviders.filter(p => p.name === 'firecrawl'),
        ...availableProviders.filter(p => p.name === 'exa'),
        ...availableProviders.filter(p => p.name === 'tavily'),
      ].filter(p => p.extract) as WebDataProvider[];

    case 'crawl': {
      // Site crawl: Firecrawl → Tavily
      const result: WebDataProvider[] = [];
      const firecrawlProvider = availableProviders.find(p => p.name === 'firecrawl');
      if (firecrawlProvider && (firecrawlProvider as any).crawl) {
        result.push(firecrawlProvider);
      }
      const tavilyProvider = availableProviders.find(p => p.name === 'tavily');
      if (tavilyProvider && (tavilyProvider as any).crawl) {
        result.push(tavilyProvider);
      }
      return result;
    }

    case 'semantic':
    // Semantic search: Exa only
      const semanticResult: WebDataProvider[] = [];
      const exaProvider = availableProviders.find(p => p.name === 'exa');
      if (exaProvider && (exaProvider as any).search) {
        semanticResult.push(exaProvider);
      }
      return semanticResult;

    case 'research': {
      // Deep research: Tavily → Exa
      const result: WebDataProvider[] = [];
      const tavilyProvider = availableProviders.find(p => p.name === 'tavily');
      if (tavilyProvider) result.push(tavilyProvider);
      const exaProviderResearch = availableProviders.find(p => p.name === 'exa');
      if (exaProviderResearch) result.push(exaProviderResearch);
      return result;
    }

    default:
      return availableProviders;
  }
}
