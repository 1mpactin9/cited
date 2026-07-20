import { handleSearch } from './commands/search.js';
import { handleFetch } from './commands/fetch.js';
import { handleExtract } from './commands/extract.js';
import { handleCrawl } from './commands/crawl.js';
import { handleResearch } from './commands/research.js';
import type { CommandOptions } from './types.js';

const VERSION = '0.0.7';

function printHelp() {
  console.log(`cited ${VERSION} - AI-friendly web data CLI

Usage:
  cited <command> [options] <input>

Commands:
  search <query>          Search the web
  fetch <url>             Fetch raw content from a URL
  extract <url>           Extract main content from a URL
  crawl <url>             Discover URLs on a website
  research <query>        Deep research on a topic

Options:
  --provider <name>       Force use a specific provider (tavily|exa|firecrawl|jina)
  --output <format>       Output format: json|text (default: json)
  --help                  Show this help
  --version               Show version
`);
}

function parseArgs(args: string[]): {
  command: string | null;
  input: string;
  options: CommandOptions;
} {
  const options: CommandOptions = {
    output: 'json',
  };
  let command: string | null = null;
  let inputParts: string[] = [];

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (arg === '--provider' && i + 1 < args.length) {
        options.provider = args[++i];
      } else if (arg === '--output' && i + 1 < args.length) {
        options.output = args[++i] as 'json' | 'text';
      } else if (arg === '--help' || arg === '-h') {
        printHelp();
        process.exit(0);
      } else if (arg === '--version' || arg === '-v') {
        console.log(VERSION);
        process.exit(0);
      }
    } else if (!command) {
      command = arg;
    } else {
      inputParts.push(arg);
    }
  }

  const input = inputParts.join(' ');
  return { command, input, options };
}

async function main() {
  const { command, input, options } = parseArgs(process.argv);

  if (!command || !input) {
    printHelp();
    process.exit(1);
  }

  let result;

  switch (command) {
    case 'search':
      result = await handleSearch(input, options);
      break;
    case 'fetch':
      result = await handleFetch(input, options);
      break;
    case 'extract':
      result = await handleExtract(input, options);
      break;
    case 'crawl':
      result = await handleCrawl(input, options);
      break;
    case 'research':
      result = await handleResearch(input, options);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }

  if (options.output === 'text' && result.success && result.data) {
    if (typeof result.data === 'string') {
      console.log(result.data);
    } else if (Array.isArray(result.data)) {
      result.data.forEach((item: any, index: number) => {
        if (index > 0) console.log('\n---\n');
        if (typeof item === 'string') {
          console.log(item);
        } else if ('title' in item && 'content' in item) {
          console.log(`## ${item.title}`);
          console.log(item.url || '');
          console.log();
          console.log(item.content);
        }
      });
    } else {
      console.log(JSON.stringify(result.data, null, 2));
    }
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(error => {
  console.error(JSON.stringify({
    success: false,
    error: error.message,
    provider: 'cli',
  }, null, 2));
  process.exit(1);
});
