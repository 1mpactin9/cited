#!/usr/bin/env node
import { chromium } from 'playwright';

async function testBrave() {
  console.log('=== TESTING BRAVE SEARCH ===');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  try {
    const query = 'javascript tutorial';
    const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    console.log(`Navigating to: ${searchUrl}`);

    const startTime = Date.now();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);
    console.log(`Page loaded in ${Date.now() - startTime}ms`);

    const html = await page.content();
    const title = await page.title();
    console.log(`Page title: ${title}`);

    if (title.includes('Access Denied') || title.includes('Captcha') ||
        html.includes('unusual traffic') || html.includes('blocked') ||
        html.length < 1000) {
      console.log('FAIL: Bot detection detected');
      console.log('Sample HTML:', html.substring(0, 500));
      return false;
    }

    const resultSelectors = ['[data-type="web"]', '.result', '.fdb', '.snippet', 'div[data-pos]'];
    let resultElements = [];
    for (const selector of resultSelectors) {
      resultElements = await page.$$(selector);
      console.log(`Found ${resultElements.length} elements with selector: ${selector}`);
      if (resultElements.length > 0) break;
    }

    if (resultElements.length === 0) {
      console.log('FAIL: No results found');
      console.log('Sample HTML:', html.substring(0, 1000));
      return false;
    }

    const titleSelectors = ['h2 a', '.title a', '.result-title a', 'a[data-testid]', 'h3 a'];
    const snippetSelectors = ['.snippet-content', '.snippet', '.description', 'p'];

    console.log('\n--- SAMPLE RESULTS ---');
    for (let i = 0; i < Math.min(3, resultElements.length); i++) {
      let title = 'No title';
      let url = 'No URL';
      let snippet = 'No snippet';

      for (const titleSel of titleSelectors) {
        const titleElement = await resultElements[i].$(titleSel);
        if (titleElement) {
          title = await titleElement.textContent() || 'No title';
          url = await titleElement.getAttribute('href') || 'No URL';
          break;
        }
      }
      for (const snippetSel of snippetSelectors) {
        const snippetElement = await resultElements[i].$(snippetSel);
        if (snippetElement) {
          snippet = await snippetElement.textContent() || 'No snippet';
          break;
        }
      }

      console.log(`${i + 1}. ${title.trim()}`);
      console.log(`   URL: ${url}`);
      console.log(`   Snippet: ${snippet.trim().substring(0, 100)}...\n`);
    }

    console.log('BRAVE SEARCH: SUCCESS');
    return true;
  } catch (error) {
    console.log(`BRAVE SEARCH FAILED: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

testBrave().then(success => {
  console.log(`\nBRAVE RESULT: ${success ? 'WORKING' : 'FAILED'}`);
  process.exit(success ? 0 : 1);
});
