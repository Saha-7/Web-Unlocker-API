// ─────────────────────────────────────────────────────────────
//  parsers/mdcomputers.js  (Web Unlocker / cheerio version)
//  Same selectors as Playwright version — now synchronous.
// ─────────────────────────────────────────────────────────────

const cheerio = require('cheerio');

// ── Extract all product links from a category/listing page ───
function parseProductLinks(html) {
  const $ = cheerio.load(html);
  const links = new Set();

  $('a[href]').each((_, el) => {
    let href = $(el).attr('href') || '';

    if (href.startsWith('/')) href = 'https://mdcomputers.in' + href;

    if (
      href.startsWith('https://mdcomputers.in/') &&
      !href.includes('/catalog/') &&
      !href.includes('route=') &&
      !href.includes('#')
    ) {
      links.add(href.split('?')[0]);
    }
  });

  return [...links];
}


// ── Return the next pagination URL, or null on last page ─────
function getNextPageUrl(html, currentUrl) {
  const $ = cheerio.load(html);

  const activeLi = $('ul.pagination li.active');
  if (!activeLi.length) return null;

  const nextLi = activeLi.next();
  if (!nextLi.length) return null;

  if (nextLi.hasClass('disabled')) return null;

  const nextA   = nextLi.find('a');
  const nextUrl = nextA.attr('href');
  if (!nextUrl) return null;

  if (!nextUrl.includes('?page=') && !nextUrl.includes('page=')) return null;
  if (nextUrl === currentUrl) return null;

  return nextUrl;
}

// ── Extract all product data from a single product page ──────
function parseProductDetails(html, url) {
  const $ = cheerio.load(html);

  const getText = (selector) => $(selector).first().text().trim() || null;

  // ── Name ──────────────────────────────────────────────────
  const name =
    getText('h1') ||
    getText('h2.product-name') ||
    getText('.product-title');

  // ── Prices ────────────────────────────────────────────────
  const salePrice     = getText('h2.special-price') || null;
  const originalPrice = getText('.price-old') || getText('.regular-price .price') || null;
  const discountBadge = getText('.discount-percentage') || null;

  // ── Product Code ──────────────────────────────────────────
  // MDComputers shows: "Product Code: YD3200C5FHBOX" inside ul.product-status li
  let productCode = null;
  $('ul.product-status li').each((_, li) => {
    if ($(li).text().includes('Product Code')) {
      productCode = $(li).find('.base-color').text().trim() || null;
    }
  });

  // ── Stock Status ──────────────────────────────────────────
  let stockStatus = null;
  $('ul.product-status li').each((_, li) => {
    if ($(li).text().includes('Availability')) {
      stockStatus = $(li).find('.base-color').text().trim() || null;
    }
  });

  // ── Rating ────────────────────────────────────────────────
  const rating = getText('.rating-num') || getText('.stars') || null;

  // ── Category (from breadcrumb) ────────────────────────────
  const breadcrumbItems = [];
  $('.breadcrumb li a').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t !== 'Home') breadcrumbItems.push(t);
  });
  const category = breadcrumbItems.length > 0 ? breadcrumbItems[0] : null;

  // ── Images — only from product gallery ───────────────────
  const images = [];
  $('.gallery-top img, .gallery-thumbs img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && !src.includes('placeholder')) {
      images.push(src.startsWith('http') ? src : 'https://mdcomputers.in' + src);
    }
  });

  // ── Specs ─────────────────────────────────────────────────
  const specs = {};
  $('#tab-specification table tr').each((_, row) => {
    const key   = $(row).find('td:first-child').text().trim();
    const value = $(row).find('td:last-child').text().trim();
    if (key && value && key !== value) specs[key] = value;
  });

  // ── Short Description ─────────────────────────────────────
  const shortDescription =
    getText('.product-description p') ||
    getText('[class*="description"] p') ||
    null;

  return {
    url,
    store: 'mdcomputers',
    name,
    productCode,
    category,
    stockStatus,
    rating,
    salePrice,
    originalPrice,
    discountBadge,
    shortDescription,
    tags  : [],
    images,
    specs,
    scrapedAt: new Date().toISOString(),
  };
}

module.exports = { parseProductLinks, getNextPageUrl, parseProductDetails };