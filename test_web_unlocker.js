// test_web_unlocker.js
// Tests Bright Data Web Unlocker API against all three stores.
// Two checks per store:
//   1. Category page  → can we extract product links?
//   2. Product page   → can we extract name, price, SKU, stock?
//
// Run: node test_web_unlocker.js
// Needs in .env:
//   BRIGHT_DATA_API_KEY=your_api_key_here

require('dotenv').config();
const https = require('https');

// ─────────────────────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────────────────────

const API_KEY = process.env.BRIGHT_DATA_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing BRIGHT_DATA_API_KEY in .env');
  console.error('   Add this line to your .env file:');
  console.error('   BRIGHT_DATA_API_KEY=ddeaae8a-26b3-4f88-893d-a4147266fca5');
  process.exit(1);
}

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
    product : 'https://mdcomputers.in/product/amd-ryzen-5-5500-100-100000457box-desktop-processor/processor',
  },
  {
    store   : 'primeabgb',
    category: 'https://www.primeabgb.com/buy-online-price-india/cpu-processor/',
    product : 'https://www.primeabgb.com/online-price-reviews-india/amd-ryzen-9-9950x3d2-dual-edition-desktop-processor-100-100001978wof/',
  },
];

// ─────────────────────────────────────────────────────────────
//  CORE FETCH via Web Unlocker REST API
//  Simple POST to api.brightdata.com/request with your API key.
//  Bright Data handles CAPTCHAs, IP rotation, JS rendering
//  and returns the final HTML of the target page.
// ─────────────────────────────────────────────────────────────

function fetchViaUnlocker(targetUrl) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
  url   : targetUrl,
  zone  : 'web_unlocker1',   // ← add this line
  format: 'raw',
});

    const options = {
      hostname: 'api.brightdata.com',
      path    : '/request',
      method  : 'POST',
      headers : {
        'Content-Type'  : 'application/json',
        'Authorization' : `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
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
//  Mirrors what your Playwright parsers extract so you can
//  verify the same data comes through the Unlocker API.
// ─────────────────────────────────────────────────────────────

function extract(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

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

function checkProductPage(store, html) {
  if (store === 'pickpcparts') {
    return {
      name   : extract(html, /<h1[^>]*elementor-heading-title[^>]*>([^<]+)<\/h1>/i),
      price  : extract(html, /pcpps-price-table[\s\S]*?<td[^>]*>([\d,₹.]+)<\/td>/i),
      partId : extract(html, /acf-list[^>]*>[\s\S]*?<li[^>]*>([A-Z0-9-]{5,30})<\/li>/i),
      inStock: /In Stock/i.test(html) ? 'In Stock' : 'Not found',
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
  console.log('🚀 Bright Data Web Unlocker API Test');
  console.log(`   API Key : ${API_KEY.substring(0, 8)}****`);
  console.log(`   Endpoint: api.brightdata.com/request`);

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

      // Show raw response snippet if not 200 to help debug
      if (status !== 200) {
        console.log(`   Raw response : ${html.substring(0, 300)}`);
      }

      const blocked = /captcha|just a moment|access denied|403|blocked/i.test(html);
      console.log(`   Blocked?     : ${blocked ? '❌ YES' : '✅ No'}`);

      results.push({ store: test.store, page: 'category', status, ms, links, blocked });

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
      results.push({ store: test.store, page: 'category', error: err.message });
    }

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

      if (status !== 200) {
        console.log(`   Raw response : ${html.substring(0, 300)}`);
      }

      const blocked = /captcha|just a moment|access denied|403|blocked/i.test(html);
      console.log(`   Blocked?     : ${blocked ? '❌ YES' : '✅ No'}`);

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
    const ok   = !r.error && !r.blocked && r.status === 200;
    const icon = ok ? '✅' : '❌';
    const detail = r.error
      ? `ERROR: ${r.error}`
      : `HTTP ${r.status} | ${r.ms}ms | blocked=${r.blocked}`;
    console.log(`  ${icon} ${r.store.padEnd(12)} ${r.page.padEnd(10)} ${detail}`);
  }

  console.log('\n📋 What to check:');
  console.log('   HTTP status = 200       → API call succeeded');
  console.log('   Product links > 0       → category pagination will work');
  console.log('   Extracted fields filled → parsers will work');
  console.log('   Blocked = false         → no bot detection triggered');
}

runTests().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});