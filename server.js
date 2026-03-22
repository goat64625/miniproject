const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3-flash-preview";
const ROOT_DIR = __dirname;
const CACHE_DIR = path.join(ROOT_DIR, "data");
const CACHE_FILE = path.join(CACHE_DIR, "product-cache.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

ensureCacheStore();

const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && requestUrl.pathname === "/api/analyze") {
      await handleAnalyze(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(requestUrl.pathname, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Internal server error." });
  }
});

async function handleAnalyze(req, res) {
  if (!GEMINI_API_KEY) {
    sendJson(res, 500, { error: "Server is missing GEMINI_API_KEY." });
    return;
  }

  const body = await readJson(req);
  const inputUrl = `${body?.url || ""}`.trim();

  if (!inputUrl) {
    sendJson(res, 400, { error: "A product URL is required." });
    return;
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(inputUrl).toString();
  } catch {
    sendJson(res, 400, { error: "Please provide a valid absolute URL." });
    return;
  }

  const cacheKey = createCacheKey(normalizedUrl);
  const cache = readCache();
  if (cache[cacheKey]) {
    sendJson(res, 200, { ...cache[cacheKey], cached: true });
    return;
  }

  const pageData = await collectPageData(normalizedUrl);
  const aiResult = await analyzeProduct(pageData);
  const responsePayload = {
    ...aiResult,
    sourceUrl: normalizedUrl,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };

  cache[cacheKey] = responsePayload;
  writeCache(cache);

  sendJson(res, 200, responsePayload);
}

async function collectPageData(inputUrl) {
  const url = new URL(inputUrl);
  const page = await fetchPageWithFallback(url);
  const html = page.html;
  const text = compactWhitespace(stripTags(html));
  const meta = extractMeta(html);
  const jsonLd = extractJsonLdProducts(html);
  const firstProduct = jsonLd[0] || {};
  const image =
    firstNonEmpty([
      pickImage(firstProduct.image),
      meta["og:image"],
      meta["twitter:image"],
      extractImageFromHtml(html, url),
    ]) || "";

  return {
    url: inputUrl,
    host: url.hostname,
    title: firstNonEmpty([firstProduct.name, meta["og:title"], meta.title, extractTitle(html)]),
    description: firstNonEmpty([
      firstProduct.description,
      meta.description,
      meta["og:description"],
      text.slice(0, 1800),
    ]),
    image,
    priceHints: collectPriceHints(firstProduct, meta, text),
    availability: firstNonEmpty([
      normalizeAvailability(firstProduct.offers?.availability),
      meta["product:availability"],
      extractAvailability(text),
    ]),
    brand: firstNonEmpty([firstProduct.brand?.name, firstProduct.brand, extractBrand(text)]),
    sourceMode: page.mode,
    pageExcerpt: text.slice(0, 6000),
  };
}

async function analyzeProduct(pageData) {
  const prompt = [
    "You analyze ecommerce product pages and return only strict JSON.",
    "Use the supplied page data to identify the product and present a user-friendly pricing summary.",
    "If a value cannot be determined, use an empty string for text fields and null for numeric fields.",
    "Return JSON with exactly these keys:",
    "productName (string),",
    "price (number|null),",
    "currency (string),",
    "originalPrice (number|null),",
    "discountPercent (number|null),",
    "availability (string),",
    "brand (string),",
    "image (string),",
    "merchant (string),",
    "summary (string),",
    "highlights (array of short strings),",
    "confidence (number 0-100),",
    "verdict (string).",
    `URL: ${pageData.url}`,
    `Host: ${pageData.host}`,
    `Page fetch mode: ${pageData.sourceMode}`,
    `Title hint: ${pageData.title || ""}`,
    `Description hint: ${pageData.description || ""}`,
    `Image hint: ${pageData.image || ""}`,
    `Price hints: ${JSON.stringify(pageData.priceHints)}`,
    `Availability hint: ${pageData.availability || ""}`,
    `Brand hint: ${pageData.brand || ""}`,
    `Page excerpt: ${pageData.pageExcerpt}`,
  ].join("\n");

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
    }
  );

  const payload = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    throw new Error(payload?.error?.message || "Gemini request failed.");
  }

  const rawText = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n").trim();
  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini did not return valid JSON.");
  }

  const fallbackPrice = chooseBestPrice(pageData.priceHints.current);
  const fallbackOriginalPrice = chooseBestPrice(pageData.priceHints.original);
  const price = numericOrNull(parsed.price, fallbackPrice);
  const originalPrice = numericOrNull(parsed.originalPrice, fallbackOriginalPrice);
  const discountPercent =
    numericOrNull(parsed.discountPercent) ??
    computeDiscount(price, originalPrice);

  return {
    productName: parsed.productName || pageData.title || "Product details unavailable",
    price,
    currency: parsed.currency || pageData.priceHints.currency || "",
    originalPrice,
    discountPercent,
    availability: parsed.availability || pageData.availability || "",
    brand: parsed.brand || pageData.brand || "",
    image: parsed.image || pageData.image || "",
    merchant: parsed.merchant || pageData.host,
    summary: parsed.summary || "AI analysis completed successfully.",
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.slice(0, 6) : [],
    confidence: clamp(Number(parsed.confidence) || 0, 0, 100),
    verdict: parsed.verdict || "Analysis complete",
    model: GEMINI_MODEL,
    sourceMode: pageData.sourceMode,
  };
}

async function fetchPageWithFallback(url) {
  const attempts = [
    { mode: "direct", target: url.toString(), headers: { "User-Agent": "Mozilla/5.0 TrustLensAI/1.0" } },
    { mode: "mirror", target: `https://r.jina.ai/http://${url.host}${url.pathname}${url.search}`, headers: {} },
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.target, { headers: attempt.headers });
      if (!response.ok) continue;
      const html = await response.text();
      if (html && html.trim()) {
        return { html, mode: attempt.mode === "direct" ? "Live fetch" : "Mirror fetch" };
      }
    } catch {
      // try next strategy
    }
  }

  throw new Error("Unable to fetch product page content for analysis.");
}

async function serveStatic(requestPath, res) {
  const sanitizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.resolve(ROOT_DIR, `.${path.posix.normalize(sanitizedPath)}`);

  if (!filePath.startsWith(ROOT_DIR)) {
    sendJson(res, 403, { error: "Forbidden." });
    return;
  }

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  if (!stat.isFile()) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
}

function ensureCacheStore() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, "{}\n", "utf8");
  }
}

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeCache(cache) {
  fs.writeFileSync(CACHE_FILE, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

function createCacheKey(inputUrl) {
  return crypto.createHash("sha256").update(inputUrl).digest("hex");
}

function extractMeta(html) {
  const meta = {};
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (titleMatch) meta.title = decodeHtml(titleMatch[1]);

  const regex = /<meta\s+[^>]*(?:name|property)=['"]([^'"]+)['"][^>]*content=['"]([^'"]*)['"][^>]*>/gi;
  let match;
  while ((match = regex.exec(html))) {
    meta[match[1].toLowerCase()] = decodeHtml(match[2]);
  }
  return meta;
}

function extractJsonLdProducts(html) {
  const scripts = [...html.matchAll(/<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi)];
  const products = [];

  for (const scriptMatch of scripts) {
    const raw = scriptMatch[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      walkJsonLd(parsed, products);
    } catch {
      // ignore malformed blocks
    }
  }

  return products;
}

function walkJsonLd(node, products) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => walkJsonLd(item, products));
    return;
  }
  if (typeof node !== "object") return;

  const type = Array.isArray(node["@type"]) ? node["@type"].join(" ") : node["@type"];
  if (typeof type === "string" && /product/i.test(type)) {
    products.push(node);
  }

  Object.values(node).forEach((value) => walkJsonLd(value, products));
}

function collectPriceHints(product, meta, text) {
  const current = [];
  const original = [];

  if (product?.offers?.price) current.push(Number(product.offers.price));
  if (meta["product:price:amount"]) current.push(Number(meta["product:price:amount"]));
  const textPrices = [...text.matchAll(/(?:\$|₹|€|£|usd\s?|inr\s?|eur\s?|gbp\s?)(\d{1,6}(?:[.,]\d{1,2})?)/gi)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
  current.push(...textPrices.slice(0, 3));

  const compareMatches = [...text.matchAll(/(?:mrp|list price|was|original price)\D{0,10}(\d{1,6}(?:[.,]\d{1,2})?)/gi)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
  original.push(...compareMatches.slice(0, 3));

  return {
    current: uniqueNumbers(current),
    original: uniqueNumbers(original),
    currency: detectCurrency(product, meta, text),
  };
}

function detectCurrency(product, meta, text) {
  return firstNonEmpty([
    product?.offers?.priceCurrency,
    meta["product:price:currency"],
    text.match(/\$/) ? "USD" : "",
    text.match(/₹|inr/i) ? "INR" : "",
    text.match(/€/i) ? "EUR" : "",
    text.match(/£/i) ? "GBP" : "",
  ]) || "";
}

function chooseBestPrice(values) {
  return Array.isArray(values) && values.length ? values[0] : null;
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value > 0))];
}

function numericOrNull(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function computeDiscount(price, originalPrice) {
  if (!price || !originalPrice || originalPrice <= price) return null;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function pickImage(imageValue) {
  if (Array.isArray(imageValue)) {
    return imageValue.find(Boolean) || "";
  }
  return typeof imageValue === "string" ? imageValue : "";
}

function extractImageFromHtml(html, baseUrl) {
  const match = html.match(/<img[^>]+src=['"]([^'"]+)['"][^>]*>/i);
  if (!match) return "";
  try {
    return new URL(match[1], baseUrl).toString();
  } catch {
    return match[1];
  }
}

function extractTitle(html) {
  return decodeHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "");
}

function extractAvailability(text) {
  const match = text.match(/(in stock|out of stock|only \d+ left|available now|currently unavailable)/i);
  return match ? match[1] : "";
}

function extractBrand(text) {
  const match = text.match(/brand\s*[:\-]?\s*([a-z0-9][a-z0-9\s&-]{1,40})/i);
  return match ? match[1].trim() : "";
}

function normalizeAvailability(value) {
  if (!value) return "";
  return String(value).split("/").pop();
}

function stripTags(html) {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function firstNonEmpty(values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

server.listen(PORT, HOST, () => {
  console.log(`TrustLens AI server listening on http://${HOST}:${PORT}`);
});
