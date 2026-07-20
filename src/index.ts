#!/usr/bin/env node
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { SearchEngine } from './search-engine.js';
import { EnhancedContentExtractor } from './enhanced-content-extractor.js';
import { WebSearchToolInput, WebSearchToolOutput, SearchResult } from './types.js';
import { isPdfUrl } from './utils.js';
import { createLogger } from './logger.js';

const log = createLogger('CLI');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const VERSION = packageJson.version;
const PROGRAM = 'cited';

class UserError extends Error {}

interface CliArgs {
  command: 'search' | 'page' | 'help' | 'version';
  query: string;
  url: string;
  limit: number;
  includeContent: boolean;
  maxContentLength?: number;
  json: boolean;
}

function printHelp(): void {
  const help = `${PROGRAM} v${VERSION} — web search and content extraction for research.

USAGE
  ${PROGRAM} <query>            Search the web and fetch full content from top results.
  ${PROGRAM} page <url>         Extract full content from a single page URL.
  ${PROGRAM} help               Show this help.

SEARCH OPTIONS
  --limit <n>            Number of results to return (1-10, default 5)
  --no-content           Return only search snippets; skip fetching page content
  --max-content <chars>  Max characters of content per result (0 = no limit)
  --json                 Emit structured JSON on stdout (agent-friendly)

PAGE OPTIONS
  --max-content <chars>  Max characters of extracted content (0 = no limit)
  --json                 Emit structured JSON on stdout

GLOBAL OPTIONS
  -h, --help             Show this help
  -v, --version          Show version

EXAMPLES
  ${PROGRAM} "effects of sleep on memory"
  ${PROGRAM} effects of sleep on memory --limit 3 --no-content
  ${PROGRAM} "effects of sleep on memory" --json
  ${PROGRAM} page https://example.com/article --max-content 2000

ENVIRONMENT
  LOG_LEVEL                  debug | info | warn | error (default: info)
  MAX_CONTENT_LENGTH         default per-result content cap (default: 500000)
  FORCE_MULTI_ENGINE_SEARCH  'true' to try every engine even if one is good
  ENABLE_RELEVANCE_CHECKING  'false' to skip result-quality scoring

Results go to stdout; logs go to stderr, so you can pipe output freely.
`;
  process.stdout.write(help);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    command: 'search',
    query: '',
    url: '',
    limit: 5,
    includeContent: true,
    maxContentLength: undefined,
    json: false,
  };

  const positional: string[] = [];
  const knownFlags = ['-h', '--help', '-v', '--version', '--no-content', '--limit', '--max-content', '--json'];
  // Pre-validate: reject unrecognized flags before any parsing
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if ((tok.startsWith('--') || (tok.startsWith('-') && tok.length > 2 && !/^\d+$/.test(tok))) && !knownFlags.includes(tok)) {
      // Check if it's a flag value (preceded by --limit or --max-content)
      const prev = argv[i - 1];
      if (prev === '--limit' || prev === '--max-content') continue;
      throw new UserError(`Unrecognized option: ${tok}. Use --help for usage information.`);
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    switch (tok) {
      case '-h':
      case '--help':
        args.command = 'help';
        return args;
      case '-v':
      case '--version':
        args.command = 'version';
        return args;
      case '--no-content':
        args.includeContent = false;
        break;
      case '--json':
        args.json = true;
        break;
      case '--limit': {
        const val = argv[++i];
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1 || num > 10) {
          throw new UserError(`--limit must be a number between 1 and 10 (got "${val ?? ''}")`);
        }
        args.limit = num;
        break;
      }
      case '--max-content': {
        const val = argv[++i];
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 0) {
          throw new UserError(`--max-content must be a non-negative number (got "${val ?? ''}")`);
        }
        args.maxContentLength = num;
        break;
      }
      default:
        positional.push(tok);
    }
  }

  if (positional.length === 0) {
    // No arguments: show help and exit non-zero to indicate usage required
    printHelp();
    process.exit(1);
    return args; // unreachable, satisfies TS
  }

  if (positional[0] === 'help') {
    args.command = 'help';
    return args;
  }

  if (positional[0] === 'page') {
    args.command = 'page';
    const url = positional.slice(1).join(' ').trim();
    if (!url) {
      throw new UserError('page requires a URL, e.g. cited page https://example.com');
    }
    try {
      new URL(url);
    } catch {
      throw new UserError(`Invalid URL: ${url}`);
    }
    args.url = url;
    return args;
  }

  // Reject 'version' as a bare positional — it's only valid as --version / -v
  if (positional[0] === 'version') {
    printHelp();
    process.stderr.write('\nError: "version" is not a search query. Use -v or --version to show version.\n\n');
    process.exit(1);
  }

  // Check for unrecognized flags
  for (const tok of argv.slice(2)) {
    if (tok.startsWith('--') || (tok.startsWith('-') && tok.length > 2 && !/^\d+$/.test(tok))) {
      // Skip known flags and their values
      const knownFlags = ['-h', '--help', '-v', '--version', '--no-content', '--limit', '--max-content', '--json'];
      if (!knownFlags.includes(tok)) {
        throw new UserError(`Unrecognized option: ${tok}. Use --help for usage information.`);
      }
    }
  }

  args.command = 'search';
  args.query = positional.join(' ').trim();
  return args;
}

function truncate(text: string, max?: number): string {
  if (!max || max <= 0 || text.length <= max) return text;
  return text.substring(0, max) + `\n\n[Content truncated at ${max} characters]`;
}

function isPlaceholderDescription(d: string): boolean {
  const t = d.trim();
  return t === '' || t === 'No description available';
}

function formatFullResults(result: WebSearchToolOutput, maxContentLength?: number): string {
  let text = `Search: "${result.query}" — ${result.total_results} result(s)\n\n`;

  result.results.forEach((r, idx) => {
    text += `[${idx + 1}] ${r.title} — ${r.url}\n`;
    if (!isPlaceholderDescription(r.description)) {
      text += `${r.description}\n`;
    }
    if (r.fullContent && r.fullContent.trim()) {
      text += `\n${truncate(r.fullContent, maxContentLength)}\n`;
    } else if (r.contentPreview && r.contentPreview.trim()) {
      text += `\n${truncate(r.contentPreview, maxContentLength)}\n`;
    } else if (r.fetchStatus === 'error') {
      text += `\n[extraction failed: ${r.error || 'unknown'}]\n`;
    }
    text += `\n---\n\n`;
  });
  return text;
}

function formatSummaries(query: string, results: Array<{ title: string; url: string; description: string }>): string {
  let text = `Search: "${query}" — ${results.length} result(s)\n\n`;
  results.forEach((r, i) => {
    text += `[${i + 1}] ${r.title} — ${r.url}\n`;
    if (!isPlaceholderDescription(r.description)) {
      text += `${r.description}\n`;
    }
    text += `\n---\n\n`;
  });
  return text;
}

function formatSinglePage(url: string, content: string, maxContentLength?: number): string {
  return `Page: ${url}\n\n${truncate(content, maxContentLength)}\n`;
}

function omitEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function formatFullResultsJson(result: WebSearchToolOutput, maxContentLength?: number): string {
  const payload = {
    query: result.query,
    total_results: result.total_results,
    search_time_ms: result.search_time_ms,
    results: result.results.map(r => {
      const desc = isPlaceholderDescription(r.description) ? '' : r.description;
      const content = r.fullContent && r.fullContent.trim() ? truncate(r.fullContent, maxContentLength) : '';
      return omitEmpty({
        title: r.title,
        url: r.url,
        description: desc,
        content,
        wordCount: r.wordCount || undefined,
        fetchStatus: r.fetchStatus,
        error: r.error,
      });
    }),
  };
  return JSON.stringify(payload) + '\n';
}

function formatSummariesJson(query: string, results: Array<{ title: string; url: string; description: string }>): string {
  const payload = {
    query,
    total_results: results.length,
    results: results.map(r => omitEmpty({
      title: r.title,
      url: r.url,
      description: isPlaceholderDescription(r.description) ? '' : r.description,
    })),
  };
  return JSON.stringify(payload) + '\n';
}

function formatSinglePageJson(url: string, content: string, maxContentLength?: number): string {
  const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
  const payload = omitEmpty({
    url,
    content: truncate(content, maxContentLength),
    wordCount,
    fetchStatus: content.trim() ? 'success' : 'error',
  });
  return JSON.stringify(payload) + '\n';
}

function categorizeError(errorMessage: string): string {
  const e = errorMessage.toLowerCase();
  if (e.includes('timeout') || e.includes('timed out')) return 'Timeout';
  if (e.includes('403') || e.includes('forbidden')) return 'Access denied';
  if (e.includes('404') || e.includes('not found')) return 'Not found';
  if (e.includes('bot') || e.includes('captcha') || e.includes('unusual traffic')) return 'Bot detection';
  if (e.includes('too large') || e.includes('content length') || e.includes('maxcontentlength')) return 'Content too long';
  if (e.includes('ssl') || e.includes('certificate') || e.includes('tls')) return 'SSL error';
  if (e.includes('network') || e.includes('connection') || e.includes('econnrefused')) return 'Network error';
  if (e.includes('dns') || e.includes('hostname')) return 'DNS error';
  return 'Other error';
}

function categorizeFailureReasons(failedResults: SearchResult[]): string[] {
  const reasonCounts = new Map<string, number>();
  failedResults.forEach(result => {
    if (result.error) {
      const category = categorizeError(result.error);
      reasonCounts.set(category, (reasonCounts.get(category) || 0) + 1);
    }
  });
  return Array.from(reasonCounts.entries()).map(([reason, count]) =>
    count > 1 ? `${reason} (${count})` : reason
  );
}

async function handleWebSearch(
  input: WebSearchToolInput,
  searchEngine: SearchEngine,
  contentExtractor: EnhancedContentExtractor
): Promise<WebSearchToolOutput> {
  const startTime = Date.now();
  const { query, limit = 5, includeContent = true } = input;

  const searchLimit = includeContent ? Math.min(limit * 2 + 2, 10) : limit;
  log.debug(`requesting ${searchLimit} results to get ${limit} non-PDF content results`);

  const searchResponse = await searchEngine.search({ query, numResults: searchLimit });
  const searchResults = searchResponse.results;

  const pdfCount = searchResults.filter(r => isPdfUrl(r.url)).length;
  const followedCount = searchResults.length - pdfCount;
  log.debug(`engine: ${searchResponse.engine}; ${limit} requested/${searchResults.length} obtained; PDF: ${pdfCount}; ${followedCount} followed`);

  const enhancedResults = includeContent
    ? await contentExtractor.extractContentForResults(searchResults, limit)
    : searchResults.slice(0, limit);

  let combinedStatus = `Search engine: ${searchResponse.engine}; ${limit} requested/${searchResults.length} obtained; PDF: ${pdfCount}; ${followedCount} followed`;

  if (includeContent) {
    const successCount = enhancedResults.filter(r => r.fetchStatus === 'success').length;
    const failedResults = enhancedResults.filter(r => r.fetchStatus === 'error');
    const failureReasons = categorizeFailureReasons(failedResults);
    const failureReasonText = failureReasons.length > 0 ? ` (${failureReasons.join(', ')})` : '';
    log.debug(`links requested: ${limit}; extracted: ${successCount}; failed: ${failedResults.length}${failureReasonText}`);
    combinedStatus += `; extracted: ${successCount}; failed: ${failedResults.length}; results: ${enhancedResults.length}`;
  }

  log.info(combinedStatus);

  return {
    results: enhancedResults,
    total_results: enhancedResults.length,
    search_time_ms: Date.now() - startTime,
    query,
    status: combinedStatus,
  };
}

async function runSearch(
  args: CliArgs,
  searchEngine: SearchEngine,
  contentExtractor: EnhancedContentExtractor
): Promise<void> {
  if (args.includeContent) {
    const result = await handleWebSearch(
      { query: args.query, limit: args.limit, includeContent: true, maxContentLength: args.maxContentLength },
      searchEngine,
      contentExtractor
    );
    log.info(`search completed, ${result.results.length} results`);
    if (args.json) {
      process.stdout.write(formatFullResultsJson(result, args.maxContentLength));
    } else {
      process.stdout.write(formatFullResults(result, args.maxContentLength));
    }
  } else {
    log.info('summaries', { query: args.query, limit: args.limit });
    const searchResponse = await searchEngine.search({ query: args.query, numResults: args.limit });
    const summaryResults = searchResponse.results.map(item => ({
      title: item.title,
      url: item.url,
      description: item.description,
    }));
    log.info(`summaries completed, ${summaryResults.length} results`);
    if (args.json) {
      process.stdout.write(formatSummariesJson(args.query, summaryResults));
    } else {
      process.stdout.write(formatSummaries(args.query, summaryResults));
    }
  }
}

async function runPage(args: CliArgs, contentExtractor: EnhancedContentExtractor): Promise<void> {
  log.info('page', { url: args.url });
  const content = await contentExtractor.extractContent({
    url: args.url,
    maxContentLength: args.maxContentLength,
  });
  log.info(`single page extracted ${content.length} characters`);
  if (args.json) {
    process.stdout.write(formatSinglePageJson(args.url, content, args.maxContentLength));
  } else {
    process.stdout.write(formatSinglePage(args.url, content, args.maxContentLength));
  }
}

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n\n`);
    printHelp();
    process.exit(1);
  }

  if (args.command === 'help') {
    printHelp();
    process.exit(0);
  }
  if (args.command === 'version') {
    process.stdout.write(`${PROGRAM} ${VERSION}\n`);
    process.exit(0);
  }

  const searchEngine = new SearchEngine();
  const contentExtractor = new EnhancedContentExtractor();

  const cleanup = async () => {
    try {
      await Promise.all([contentExtractor.closeAll(), searchEngine.closeAll()]);
    } catch (error) {
      log.error('error during cleanup', error);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT', cleanup));
  process.on('SIGTERM', () => void shutdown('SIGTERM', cleanup));

  try {
    if (args.command === 'page') {
      await runPage(args, contentExtractor);
    } else {
      await runSearch(args, searchEngine, contentExtractor);
    }
  } catch (error) {
    log.error('command failed', error);
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    await cleanup();
    process.exit(1);
  }

  await cleanup();
  process.exit(0);
}

async function shutdown(signal: string, cleanup: () => Promise<void>): Promise<void> {
  log.info(`${signal} received, shutting down`);
  await cleanup();
  process.exit(0);
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Rejection', reason);
});

process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception', error);
  process.exit(1);
});

main().catch((error: unknown) => {
  log.error('fatal error', error);
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
