// ─────────────────────────────────────────────────────────────
//  src/scraper.js  —  Multi-store price scraper (Web Unlocker API)
//
//  Run: node src/scraper.js
//
//  Replaces Playwright + Bright Data Browser API with the
//  Web Unlocker REST API. No browser process needed.
//  Same output format, same resumable logic, same folder structure.
//
//  Needs in .env:
//    BRIGHT_DATA_API_KEY=your_key
//    BRIGHT_DATA_ZONE=web_unlocker1        ← your zone name
// ─────────────────────────────────────────────────────────────

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { STORES } = require('./urls');

const API_KEY = process.env.BRIGHT_DATA_API_KEY;
const ZONE    = process.env.BRIGHT_DATA_ZONE;

if (!API_KEY) throw new Error('Missing BRIGHT_DATA_API_KEY in .env');
if (!ZONE)    throw new Error('Missing BRIGHT_DATA_ZONE in .env');

// ─────────────────────────────────────────────────────────────
//  WEB UNLOCKER FETCH
//  Single function replaces all browser management from v1.
//  Sends a POST to api.brightdata.com/request and returns HTML.
// ─────────────────────────────────────────────────────────────

const https = require('https');

function fetchViaUnlocker(targetUrl, retries = 3) {
  const attempt = (n) => new Promise((resolve, reject) => {
    const body = JSON.stringify({
      url   : targetUrl,
      zone  : ZONE,
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
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    req.setTimeout(120_000, () => {
      req.destroy(new Error('Request timeout after 120s'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });

  // Retry with backoff
  const run = async (n) => {
    try {
      return await attempt(n);
    } catch (err) {
      if (n < retries) {
        const wait = n * 4000;
        console.log(`  ⏳ Attempt ${n} failed (${err.message.substring(0, 60)}) — retrying in ${wait / 1000}s`);
        await new Promise(r => setTimeout(r, wait));
        return run(n + 1);
      }
      throw err;
    }
  };

  return run(1);
}

// ─────────────────────────────────────────────────────────────
//  FILE HELPERS — identical to v1, same output structure
// ─────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getPaths(storeName, categorySlug) {
  const dir = path.join('output', storeName, categorySlug);
  return {
    dir,
    urlsCache   : path.join(dir, 'collected_urls.json'),
    visitedCache: path.join(dir, 'visited.json'),
    fullOutput  : path.join(dir, 'products_full.json'),
    priceOutput : path.join(dir, 'products_prices.json'),
  };
}

function appendProduct(fullOutputPath, product) {
  const existing = readJson(fullOutputPath, []);
  existing.push(product);
  writeJson(fullOutputPath, existing);
}

function rebuildPriceFile(fullOutputPath, priceOutputPath) {
  const all = readJson(fullOutputPath, []);
  const prices = all.map(p => ({
    store         : p.store,
    sku           : p.sku,
    name          : p.name,
    category      : p.category,
    salePrice     : p.salePrice,
    originalPrice : p.originalPrice,
    stockStatus   : p.stockStatus,
    discountBadge : p.discountBadge,
    partId        : p.partId,
    partId2       : p.partId2,
    lowestPrice   : p.lowestPrice,
    retailerPrices: p.retailerPrices,
    tags          : p.tags,
    url           : p.url,
    scrapedAt     : p.scrapedAt,
    scrapedVia    : p.scrapedVia,
  }));
  writeJson(priceOutputPath, prices);
}

// ─────────────────────────────────────────────────────────────
//  URL COLLECTION
//  Paginates through category pages, collects all product URLs.
//  Caches to collected_urls.json — resumable if interrupted.
// ─────────────────────────────────────────────────────────────

async function collectUrlsForCategory(store, startUrl, urlsCachePath) {
  // Resume from cache if already collected
  const saved = readJson(urlsCachePath, null);
  if (saved) {
    console.log(`  ♻️  Loaded ${saved.length} cached URLs`);
    return new Set(saved);
  }

  const { parser } = store;
  const productUrls      = new Set();
  const visitedListingUrls = new Set(); // infinite loop guard
  let currentUrl = startUrl;
  let pageNum    = 1;

  while (currentUrl) {
    if (visitedListingUrls.has(currentUrl)) {
      console.log(`  ⚠️  Pagination loop detected at ${currentUrl} — stopping`);
      break;
    }
    visitedListingUrls.add(currentUrl);

    console.log(`  📄 Page ${pageNum}: ${currentUrl}`);

    try {
      const html  = await fetchViaUnlocker(currentUrl);
      const links = parser.parseProductLinks(html);
      console.log(`     ↳ ${links.length} links`);
      links.forEach(l => productUrls.add(l));

      currentUrl = parser.getNextPageUrl(html, currentUrl);
      pageNum++;

    } catch (err) {
      console.error(`  ❌ Listing page error: ${err.message}`);
      break;
    }

    // Polite delay between listing pages
    await new Promise(r => setTimeout(r, 1500));
  }

  writeJson(urlsCachePath, [...productUrls]);
  return productUrls;
}

// ─────────────────────────────────────────────────────────────
//  PRODUCT SCRAPING
// ─────────────────────────────────────────────────────────────

async function scrapeProductSafe(store, productUrl) {
  const { parser } = store;

  try {
    const html    = await fetchViaUnlocker(productUrl);
    const product = parser.parseProductDetails(html, productUrl);

    if (product) product.scrapedVia = 'web_unlocker';
    return product;

  } catch (err) {
    console.error(`  ❌ Product error: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  CATEGORY ORCHESTRATOR
// ─────────────────────────────────────────────────────────────

async function scrapeCategory(store, category) {
  const { name: storeName } = store;
  const { slug, url: startUrl } = category;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🏪 Store: ${storeName}  📂 Category: ${slug}`);
  console.log(`${'─'.repeat(60)}`);

  const paths = getPaths(storeName, slug);
  ensureDir(paths.dir);

  const productUrls = await collectUrlsForCategory(store, startUrl, paths.urlsCache);
  console.log(`  ✅ ${productUrls.size} product URLs total`);

  const visited = new Set(readJson(paths.visitedCache, []));
  const total   = productUrls.size;
  let done      = visited.size;

  if (visited.size > 0) {
    console.log(`  ♻️  Resuming: ${visited.size} done, ${total - visited.size} remaining`);
  }

  for (const productUrl of productUrls) {
    if (visited.has(productUrl)) continue;
    done++;

    process.stdout.write(`  🛒 [${done}/${total}] `);

    const product = await scrapeProductSafe(store, productUrl);

    if (product?.name) {
      appendProduct(paths.fullOutput, product);
      rebuildPriceFile(paths.fullOutput, paths.priceOutput);
      console.log(`🌐 ${product.name.substring(0, 55)}`);
    } else {
      console.log(`⚠️  No data — ${productUrl}`);
    }

    // Always mark visited even on failure — don't retry endlessly
    visited.add(productUrl);
    writeJson(paths.visitedCache, [...visited]);

    // Polite delay between product requests
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n  🏁 ${storeName}/${slug} complete: ${done} products`);
  console.log(`     Full  → ${paths.fullOutput}`);
  console.log(`     Price → ${paths.priceOutput}`);
}

// ─────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────

async function scrape() {
  console.log('🚀 Multi-store price scraper v2 (Web Unlocker API)\n');
  console.log(`   API Key : ${API_KEY.substring(0, 8)}****`);
  console.log(`   Zone    : ${ZONE}`);
  console.log(`   Stores  : ${STORES.map(s => s.name).join(', ')}`);

  const totalCategories = STORES.reduce((acc, s) => acc + s.categories.length, 0);
  console.log(`   Categories: ${totalCategories}\n`);

  for (const store of STORES) {
    for (const category of store.categories) {
      try {
        await scrapeCategory(store, category);
      } catch (err) {
        console.error(`\n❌ Failed: ${store.name}/${category.slug}: ${err.message}`);
      }
    }
  }

  console.log('\n\n🎉 All stores and categories complete!');
  console.log('Output saved in: output/<store>/<category>/');
}

scrape().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});