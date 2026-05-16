const cheerio = require('cheerio');

const BASE = 'https://mdcomputers.in';

function cleanText(value) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function absoluteUrl(href) {
  if (!href) return null;

  if (href.startsWith('http')) {
    return href.split('?')[0];
  }

  if (href.startsWith('/')) {
    return (BASE + href).split('?')[0];
  }

  return (BASE + '/' + href)
    .replace(/([^:]\/)\/+/g, '$1')
    .split('?')[0];
}

/*
|--------------------------------------------------------------------------
| PRODUCT LINKS
|--------------------------------------------------------------------------
*/

function parseProductLinks(html) {
  const $ = cheerio.load(html);

  const links = new Set();

  $('a[href*="product/"]').each((_, el) => {
    const href = absoluteUrl(
      $(el).attr('href')
    );

    if (!href) return;

    /*
    |--------------------------------------------------------------------------
    | ONLY real product pages
    |--------------------------------------------------------------------------
    */

    if (
      href.includes('/product/') &&
      !href.includes('/catalog/') &&
      !href.includes('/category/')
    ) {
      links.add(href);
    }
  });

  return [...links];
}

/*
|--------------------------------------------------------------------------
| PAGINATION
|--------------------------------------------------------------------------
|
| MD Computers uses:
| ?page=2
|--------------------------------------------------------------------------
*/

function getNextPageUrl(html, currentUrl) {
  const $ = cheerio.load(html);

  /*
  |--------------------------------------------------------------------------
  | If current page has products,
  | try next page directly
  |--------------------------------------------------------------------------
  */

  const productCount = $('a[href*="/product/"]').length;

  if (productCount === 0) {
    return null;
  }

  const url = new URL(currentUrl);

  const currentPage = parseInt(
    url.searchParams.get('page') || '1',
    10
  );

  const nextPage = currentPage + 1;

  url.searchParams.set('page', nextPage);

  return url.toString();
}

/*
|--------------------------------------------------------------------------
| PRODUCT DETAILS
|--------------------------------------------------------------------------
*/

function parseProductDetails(
  html,
  url
) {
  const $ = cheerio.load(html);

  const bodyText = $('body').text();

  /*
  |--------------------------------------------------------------------------
  | NAME
  |--------------------------------------------------------------------------
  */

  const name =
    cleanText(
      $('h1.product-name-title')
        .first()
        .text()
    ) ||
    cleanText(
      $('h1').first().text()
    ) ||
    null;

  /*
  |--------------------------------------------------------------------------
  | PRICES
  |--------------------------------------------------------------------------
  */

  const salePrice =
    cleanText(
      $('h2.special-price')
        .first()
        .text()
    ) ||
    cleanText(
      $('.special-price')
        .first()
        .text()
    ) ||
    null;

  const originalPrice =
    cleanText(
      $('.price-old')
        .first()
        .text()
    ) ||
    null;

  const discountBadge =
    cleanText(
      $('.discount-percentage')
        .first()
        .text()
    ) ||
    null;

  /*
  |--------------------------------------------------------------------------
  | PRODUCT STATUS
  |--------------------------------------------------------------------------
  */

  let brand = null;
  let productCode = null;
  let stockStatus = null;

  $('ul.product-status li, ul.list-unstyled.product-status li')
    .each((_, el) => {
      const text = cleanText(
        $(el).text()
      );

      if (!text) return;

      /*
      |--------------------------------------------------------------------------
      | BRAND
      |--------------------------------------------------------------------------
      */

      if (
        text.toLowerCase().includes('brand')
      ) {
        brand =
          cleanText(
            $(el)
              .find('a')
              .text()
          ) ||
          cleanText(
            $(el)
              .find('.base-color')
              .text()
          ) ||
          brand;
      }

      /*
      |--------------------------------------------------------------------------
      | PRODUCT CODE
      |--------------------------------------------------------------------------
      */

      if (
        text
          .toLowerCase()
          .includes('product code')
      ) {
        productCode =
          cleanText(
            $(el)
              .find('.base-color')
              .text()
          ) ||
          productCode;
      }

      /*
      |--------------------------------------------------------------------------
      | STOCK
      |--------------------------------------------------------------------------
      */

      if (
        text
          .toLowerCase()
          .includes('availability')
      ) {
        const availability =
          cleanText(
            $(el)
              .find('.base-color')
              .text()
          ) || text;

        if (
          /in stock/i.test(
            availability
          )
        ) {
          stockStatus = 'In Stock';
        }
        else {
          stockStatus = 'Out of Stock';
        }
      }
    });

  /*
  |--------------------------------------------------------------------------
  | FALLBACK STOCK
  |--------------------------------------------------------------------------
  */

  if (!stockStatus) {
    stockStatus =
      /out of stock/i.test(bodyText)
        ? 'Out of Stock'
        : 'In Stock';
  }

  /*
  |--------------------------------------------------------------------------
  | DESCRIPTION
  |--------------------------------------------------------------------------
  */

  let shortDescription =
    cleanText(
      $('.short-description')
        .text()
    ) ||
    cleanText(
      $('#tab-description').text()
    ) ||
    null;

  /*
  |--------------------------------------------------------------------------
  | IMAGES
  |--------------------------------------------------------------------------
  */

  const images = new Set();

  $('img').each((_, el) => {
    let src =
      $(el).attr('src') ||
      $(el).attr('data-src');

    if (!src) return;

    if (
      src.startsWith('//')
    ) {
      src = 'https:' + src;
    }

    if (
      src.includes('image/catalog') ||
      src.includes('/cache/')
    ) {
      images.add(
        absoluteUrl(src)
      );
    }
  });

  /*
  |--------------------------------------------------------------------------
  | SPECS
  |--------------------------------------------------------------------------
  */

  const specs = {};

  $('table tr').each((_, row) => {
    const key = cleanText(
      $(row)
        .find('td, th')
        .eq(0)
        .text()
    );

    const value = cleanText(
      $(row)
        .find('td, th')
        .eq(1)
        .text()
    );

    if (key && value) {
      specs[key] = value;
    }
  });

  /*
  |--------------------------------------------------------------------------
  | TAGS
  |--------------------------------------------------------------------------
  */

  const tags = [];

  $('.tags a').each((_, el) => {
    const tag = cleanText(
      $(el).text()
    );

    if (tag) {
      tags.push(tag);
    }
  });

  return {
    url,
    store: 'mdcomputers',

    name,

    sku: productCode,
    model: productCode,
    modelNumber: productCode,
    productCode,

    brand,

    category: 'Processor',

    stockStatus,

    salePrice,
    originalPrice,
    discountBadge,

    shortDescription,

    tags,

    images: [...images],

    specs,

    scrapedAt:
      new Date().toISOString(),

    scrapedVia:
      'web_unlocker',
  };
}

module.exports = {
  parseProductLinks,
  getNextPageUrl,
  parseProductDetails,
};