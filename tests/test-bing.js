#!/usr/bin/env node
import { chromium } from 'playwright';

async function testBing() {
  console.log('=== TESTING BING SEARCH ===');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  try {
    const query = 'javascript tutorial';
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=5`;
    console.log(`Navigating to: ${searchUrl}`);

    const startTime = Date.now();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log(`Page loaded in ${Date.now() - startTime}ms`);

    const html = await page.content();
    const title = await page.title();
    console.log(`Page title: ${title}`);

    if (title.includes('Access Denied') || title.includes('Captcha') || html.includes('unusual traffic')) {
      console.log('FAIL: Bot detection detected');
      return false;
    }

    const resultElements = await page.$$('.b_algo');
    console.log(`Found ${resultElements.length} .b_algo elements`);

    if (resultElements.length === 0) {
      console.log('FAIL: No results found');
      return false;
    }

    console.log('\n--- SAMPLE RESULTS ---');
    for (let i = 0; i < Math.min(3, resultElements.length); i++) {
      const titleElement = await resultElements[i].$('h2 a');
      const snippetElement = await resultElements[i].$('.b_caption p');
      const resultTitle = titleElement ? await titleElement.textContent() : 'No title';
      const url = titleElement ? await titleElement.getAttribute('href') : 'No URL';
      const snippet = snippetElement ? await snippetElement.textContent() : 'No snippet';
      console.log(`${i + 1}. ${resultTitle?.trim()}`);
      console.log(`   URL: ${url}`);
      console.log(`   Snippet: ${snippet?.trim().substring(0, 100)}...\n`);
    }

    console.log('BING SEARCH: SUCCESS');
    return true;
  } catch (error) {
    console.log(`BING SEARCH FAILED: ${error.message}`);
    return false;
  } finally {
    await browser.close();
  }
}

testBing().then(success => {
  console.log(`\nBING RESULT: ${success ? 'WORKING' : 'FAILED'}`);
  process.exit(success ? 0 : 1);
});
