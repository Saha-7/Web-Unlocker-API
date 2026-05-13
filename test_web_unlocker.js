// test_web_unlocker.js
// Tests Bright Data Web Unlocker API against all three stores.
// Two checks per store:
//   1. Category page  → can we extract product links?
//   2. Product page   → can we extract name, price, SKU, stock?
//
// Run: node test_web_unlocker.js
// Needs in .env:
//   BRIGHT_DATA_WEB_UNLOCKER_TOKEN=your_token_here
//   (or BRIGHT_DATA_USERNAME + BRIGHT_DATA_PASSWORD if using proxy format)

require('dotenv').config();
const https = require('https');

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────

// Web Unlocker can be called two ways depending on your Bright Data zone setup.
// Most common for Web Unlocker API is the proxy format:
//   host : brd.superproxy.io
//   port : 33335
//   auth : brd-customer-<id>-zone-<zone>:<password>
//
// Set these in your .env:
const PROXY_HOST = 'brd.superproxy.io';
const PROXY_PORT = 33335;
const PROXY_AUTH = process.env.BRIGHT_DATA_WEB_UNLOCKER_AUTH; // full auth string

// ── Test URLs — one category + one product per store ─────────
const TESTS = [
  {
    store   : 'pickpcparts',
    category: 'https://pickpcparts.in/processors/',
    product : 'https://pickpcparts.in/processors/amd-ryzen-5-5600x/',
  },
  {
    store   : 'mdcomputers',
    category: 'https://mdcomputers.in/catalog/processor',
    product : 'https://mdcomputers.in/product/amd-ryzen-5-5600x',
  },
  {
    store   : 'primeabgb',
    category: 'https://www.primeabgb.com/buy-online-price-india/cpu-processor/',
    product : 'https://www.primeabgb.com/online-price-reviews-india/amd-ryzen-5-5600x-processor/',
  },
];

// ─────────────────────────────────────────────────────────────
//  CORE FETCH via Web Unlocker proxy
// ─────────────────────────────────────────────────────────────

// Web Unlocker works as an HTTP proxy — you send your target URL through it.
// Bright Data handles CAPTCHAs, IP rotation, JS rendering (if needed) on their end.
// Returns the final HTML of the target page.

function fetchViaUnlocker(targetUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      url    : targetUrl,
      format : 'raw',   // returns the HTML directly
    });

    const options = {
      hostname: 'api.brightdata.com',
      path    : '/request',
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${process.env.BRIGHT_DATA_API_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, html: data }));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
//  SIMPLE HTML PARSERS (no Playwright — just regex/string ops)
//  These mirror what your Playwright parsers extract,
//  so you can verify the same data comes through.
// ─────────────────────────────────────────────────────────────

// Grab first match of a regex from html, return null if not found
function extract(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

// Count how many product links appear on a category page
function checkCategoryPage(store, html) {
  const patterns = {
    pickpcparts: /href="(https:\/\/pickpcparts\.in\/(?:processors|rams|graphics_cards|motherboards)\/[^"]+)"/g,
    mdcomputers: /href="(https:\/\/mdcomputers\.in\/product\/[^"?]+)"/g,
    primeabgb  : /href="(https:\/\/www\.primeabgb\.com\/online-price-reviews-india\/[^"?]+)"/g,
  };

  const pattern = patterns[store];
  const links   = new Set();
  let match;
  while ((match = pattern.exec(html)) !== null) links.add(match[1]);

  return links.size;
}

// Extract key fields from a product page HTML (rough check — same fields
// your real parsers pull; verifies the content is present in the response)
function checkProductPage(store, html) {
  if (store === 'pickpcparts') {
    return {
      name      : extract(html, /<h1[^>]*elementor-heading-title[^>]*>([^<]+)<\/h1>/i),
      price     : extract(html, /pcpps-price-table[^>]*>[\s\S]*?<td[^>]*>([\d,₹.]+)<\/td>/i),
      partId    : extract(html, /acf-list[^>]*>[\s\S]*?<li[^>]*>([A-Z0-9-]{5,30})<\/li>/i),
      inStock   : /In Stock/i.test(html) ? 'In Stock' : 'Not found',
    };
  }

  if (store === 'mdcomputers') {
    return {
      name       : extract(html, /<h1[^>]*>([^<]{10,})<\/h1>/i),
      price      : extract(html, /special-price[^>]*>([\d,₹\s.]+)</i),
      productCode: extract(html, /Product Code[\s\S]*?base-color[^>]*>([A-Z0-9-]{4,30})</i),
      inStock    : /In Stock/i.test(html) ? 'In Stock' : 'Not found',
    };
  }

  if (store === 'primeabgb') {
    return {
      name   : extract(html, /class="product_title[^"]*"[^>]*>([^<]+)</i),
      price  : extract(html, /woocommerce-Price-amount[^>]*>([\d,₹\s.]+)</i),
      sku    : extract(html, /class="sku"[^>]*>([^<]+)</i),
      inStock: /In Stock/i.test(html) ? 'In Stock' : 'Not found',
    };
  }

  return {};
}

// ─────────────────────────────────────────────────────────────
//  RUNNER
// ─────────────────────────────────────────────────────────────

function separator(label) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'─'.repeat(60)}`);
}

async function runTests() {
  if (!PROXY_AUTH) {
    console.error('❌ Missing BRIGHT_DATA_WEB_UNLOCKER_AUTH in .env');
    console.error('   Format: brd-customer-<id>-zone-<zonename>:<password>');
    process.exit(1);
  }

  console.log('🚀 Web Unlocker API Test');
  console.log(`   Proxy : ${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`   Auth  : ${PROXY_AUTH.split(':')[0]}:****`);

  const results = [];

  for (const test of TESTS) {
    separator(`Store: ${test.store.toUpperCase()}`);

    // ── 1. Category page ─────────────────────────────────────
    console.log(`\n📄 Category: ${test.category}`);
    try {
      const start = Date.now();
      const { status, html } = await fetchViaUnlocker(test.category);
      const ms    = Date.now() - start;
      const links = checkCategoryPage(test.store, html);

      console.log(`   HTTP status  : ${status}`);
      console.log(`   Response size: ${(html.length / 1024).toFixed(1)} KB`);
      console.log(`   Time         : ${ms}ms`);
      console.log(`   Product links: ${links}`);

      const blocked = /captcha|just a moment|access denied|403|blocked/i.test(html);
      console.log(`   Blocked?     : ${blocked ? '❌ YES — HTML looks like a block page' : '✅ No'}`);

      results.push({ store: test.store, page: 'category', status, ms, links, blocked });

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      results.push({ store: test.store, page: 'category', error: err.message });
    }

    // Small gap between requests
    await new Promise(r => setTimeout(r, 2000));

    // ── 2. Product page ──────────────────────────────────────
    console.log(`\n🛒 Product: ${test.product}`);
    try {
      const start = Date.now();
      const { status, html } = await fetchViaUnlocker(test.product);
      const ms    = Date.now() - start;
      const data  = checkProductPage(test.store, html);

      console.log(`   HTTP status  : ${status}`);
      console.log(`   Response size: ${(html.length / 1024).toFixed(1)} KB`);
      console.log(`   Time         : ${ms}ms`);
      console.log(`   Extracted    :`, data);

      const blocked = /captcha|just a moment|access denied|403|blocked/i.test(html);
      console.log(`   Blocked?     : ${blocked ? '❌ YES — HTML looks like a block page' : '✅ No'}`);

      results.push({ store: test.store, page: 'product', status, ms, data, blocked });

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      results.push({ store: test.store, page: 'product', error: err.message });
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // ── Summary ───────────────────────────────────────────────
  separator('SUMMARY');
  for (const r of results) {
    const ok = !r.error && !r.blocked && r.status === 200;
    const icon = ok ? '✅' : '❌';
    const detail = r.error
      ? `ERROR: ${r.error}`
      : `HTTP ${r.status} | ${r.ms}ms | blocked=${r.blocked}`;
    console.log(`  ${icon} ${r.store.padEnd(12)} ${r.page.padEnd(10)} ${detail}`);
  }

  console.log('\n✅ Test complete.');
  console.log('   If all rows show ✅ and product links > 0 and fields extracted,');
  console.log('   the Web Unlocker API is working and you can port the full scraper.');
}

runTests().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});