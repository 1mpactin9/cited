#!/usr/bin/env node
import { SearchEngine } from '../dist/search-engine.js';

async function testSearchEngine(query = 'javascript programming', numResults = 3) {
  console.log('Testing cited-cli - All Engines');
  console.log('===============================================');
  console.log(`Query: "${query}"`);
  console.log(`Expected results: ${numResults}\n`);

  const searchEngine = new SearchEngine();

  try {
    const startTime = Date.now();
    const result = await searchEngine.search({ query, numResults, timeout: 15000 });
    const elapsed = Date.now() - startTime;

    console.log(`Search completed in ${elapsed}ms`);
    console.log(`Engine used: ${result.engine}`);
    console.log(`Results found: ${result.results.length}\n`);

    if (result.results.length === 0) {
      console.log('FAIL: No results found!');
      return false;
    }

    console.log('Results:');
    console.log('===========');
    result.results.forEach((item, index) => {
      console.log(`${index + 1}. ${item.title}`);
      console.log(`   ${item.url}`);
      console.log(`   ${item.description.substring(0, 100)}${item.description.length > 100 ? '...' : ''}\n`);
    });

    const validResults = result.results.filter(r =>
      r.title && r.title !== 'No title' &&
      r.url && r.url.startsWith('http') &&
      r.description && r.description !== 'No description available'
    );

    console.log(`Valid results: ${validResults.length}/${result.results.length}`);
    return validResults.length > 0;
  } catch (error) {
    console.error('Search failed:', error.message);
    return false;
  } finally {
    await searchEngine.closeAll();
  }
}

async function runTests() {
  console.log('Running comprehensive search engine tests...\n');

  const testQueries = ['javascript programming', 'climate change effects', 'machine learning basics'];
  let passedTests = 0;

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    console.log(`\nTest ${i + 1}/${testQueries.length}: "${query}"`);
    console.log('-'.repeat(50));

    const success = await testSearchEngine(query, 5);
    if (success) {
      passedTests++;
      console.log('PASS');
    } else {
      console.log('FAIL');
    }

    if (i < testQueries.length - 1) {
      console.log('\nWaiting 2 seconds before next test...');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log('\nTest Summary');
  console.log('===============');
  console.log(`Tests passed: ${passedTests}/${testQueries.length}`);
  console.log(`Success rate: ${Math.round((passedTests / testQueries.length) * 100)}%`);
  process.exit(passedTests === testQueries.length ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { testSearchEngine, runTests };
