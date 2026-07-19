<div align="center">
    <h1>cited.</h1>
    <p>
        <a href="#install">Install</a> •
        <a href="#usage">Usage</a> •
        <a href="#features">Features</a>
    </p>
</div>

A command-line tool for searching the web and pulling clean, readable content out of the pages it finds - built so that everything it returns is traceable to a real source you can check, cite, and verify yourself.

`cited` runs multi-engine web search (Bing, Brave, DuckDuckGo) with automatic fallback, then follows the top results to extract their main content. Results and page content go to stdout; logs go to stderr, so you can pipe output into a file or another tool without noise.

## Install

Pick whichever fits:

```bash
# 1. Run it on the fly without installing
npx @1mpactin9/cited "effects of sleep on memory"

# 2. Install globally, then use the `cited` command
npm install -g @1mpactin9/cited
cited "effects of sleep on memory"

# 3. Clone and build manually
git clone https://github.com/1mpactin9/cited.git
cd cited
npm install
npm run build
node dist/index.js "effects of sleep on memory"
```

> Browser-based search and extraction (Bing, Brave, and the browser fallback for content) use Playwright. After install, enable them with `npx playwright install`. Without it, `cited` still works - it falls back to DuckDuckGo search and axios-based content extraction.

## Usage

```
cited <query>            Search the web and fetch full content from top results.
cited page <url>         Extract full content from a single page URL.
cited help               Show help.
```

### Search options

| Option | Description |
|---|---|
| `--limit <n>` | Number of results to return (1-10, default 5) |
| `--no-content` | Return only search snippets; skip fetching page content |
| `--max-content <chars>` | Max characters of content per result (0 = no limit) |

### Page options

| Option | Description |
|---|---|
| `--max-content <chars>` | Max characters of extracted content (0 = no limit) |

### Global options

| Option | Description |
|---|---|
| `-h, --help` | Show help |
| `-v, --version` | Show version |

### Examples

```bash
# Full search - top results with extracted content
cited "effects of sleep on memory"

# Lightweight - snippets only, no page fetching
cited effects of sleep on memory --limit 3 --no-content

# Pull content from a specific page
cited page https://example.com/article --max-content 2000

# Pipe results somewhere useful
cited "model context protocol" --no-content > results.txt
```

## Features

| Feature | What it does |
|---|---|
| Multi-engine search | Tries Bing, Brave, and DuckDuckGo in order, scoring results for relevance and falling back automatically when an engine is blocked or returns low-quality results. |
| Full-content search | Searches, then follows the top non-PDF links and extracts the main text of each page so you can read and cite the actual source. |
| Summaries search | Lightweight mode (`--no-content`) that returns titles, URLs, and snippets without following links. |
| Single-page extraction | `cited page <url>` pulls clean, readable content out of one page - handy for citing or reading a known source. |
| Source-grounded output | Every result carries its URL and timestamp; nothing is presented without a source you can open and verify. |

## Environment

| Variable | Description |
|---|---|
| `LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` (default: `info`) |
| `MAX_CONTENT_LENGTH` | Default per-result content cap (default: `500000`) |
| `FORCE_MULTI_ENGINE_SEARCH` | `true` to try every engine even if one already returns good results |
| `ENABLE_RELEVANCE_CHECKING` | `false` to skip result-quality scoring |

## Documentation

- [`ETHICS.md`](./docs/ETHICS.md) - the ethical commitments behind the product
- [`PRODUCT.md`](./docs/PRODUCT.md) - about the product
- [`RESPONSIBLE_USE.md`](./docs/RESPONSIBLE_USE.md) - what the product is and isn't meant for, and guidance for using it well
- [`LICENSE.md`](./LICENSE.md) - usage terms

## Status

Early stage. `cited` currently ships the search and source-extraction engine; broader academic-workflow features are on the roadmap.
