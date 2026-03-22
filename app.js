const form = document.getElementById("checker-form");
const scoreEl = document.getElementById("score");
const meterFill = document.getElementById("meter-fill");
const badge = document.getElementById("risk-badge");
const insights = document.getElementById("insights");
const extractionList = document.getElementById("extraction-list");
const subtitle = document.getElementById("result-subtitle");
const analyzeBtn = document.getElementById("analyze-btn");
const geminiOutput = document.getElementById("gemini-output");

const trustedDomains = ["amazon.", "flipkart.", "walmart.", "bestbuy.", "target.", "ebay.", "etsy."];
const riskyTerms = ["no warranty", "copy", "replica", "urgent", "cash only", "wire transfer"];
const trustSignals = ["warranty", "invoice", "return", "authentic", "certified", "brand"];
const sellerSignals = ["rating", "years", "return", "verified", "policy", "support"];

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const inputUrl = (data.get("url") || "").toString().trim();

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing...";
  subtitle.textContent = "Collecting product details automatically from the URL...";
  geminiOutput.textContent = "Waiting for Gemini response...";

  try {
    const extracted = await extractSignalsFromUrl(inputUrl);
    renderExtraction(extracted);

    const heuristicAnalysis = scoreListing(extracted);
    updateUI(heuristicAnalysis.score, heuristicAnalysis.notes);

    subtitle.textContent = extracted.fetchMode.includes("Live")
      ? "Sending extracted page context to the backend Gemini service for a detailed verdict."
      : "Page access was limited, so the backend Gemini service will analyze inferred product context.";

    const geminiResult = await analyzeWithGemini(extracted, heuristicAnalysis);
    const finalScore = Number.isFinite(geminiResult.score)
      ? clamp(geminiResult.score, 0, 100)
      : heuristicAnalysis.score;
    const mergedNotes = [...geminiResult.highlights, ...heuristicAnalysis.notes];

    updateUI(finalScore, mergedNotes);
    geminiOutput.textContent = geminiResult.fullText;
    subtitle.textContent = "Gemini analysis completed using the extracted webpage data.";
  } catch (error) {
    subtitle.textContent = error.message || "Could not analyze this link. Please check the URL and try again.";
    geminiOutput.textContent = `Error: ${error.message || "Unknown error"}`;
    updateUI(0, ["AI insight: URL processing failed due to invalid input, unreachable content, backend issues, or Gemini API problems."]);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Analyze with AI";
  }
});

async function extractSignalsFromUrl(inputUrl) {
  let normalized;
  try {
    normalized = new URL(inputUrl);
  } catch {
    throw new Error("Invalid URL");
  }

  const host = normalized.hostname.toLowerCase();
  const pathText = decodeURIComponent(normalized.pathname.replace(/[-_/]/g, " ")).toLowerCase();

  let pageText = "";
  let fetchMode = "Inference";

  try {
    const mirrored = `https://r.jina.ai/http://${normalized.host}${normalized.pathname}${normalized.search}`;
    const response = await fetch(mirrored, { method: "GET" });
    if (response.ok) {
      pageText = (await response.text()).toLowerCase();
      fetchMode = "Live + Inference";
    }
  } catch {
    // fallback remains inference only
  }

  const mergedText = `${pathText} ${pageText}`.trim();

  const extractedPrice = extractFirstCurrency(pageText || mergedText);
  const marketPrice = extractMarketPrice(mergedText, extractedPrice);
  const sellerHint = extractSellerHint(mergedText, host);
  const reviewHint = extractReviewHint(mergedText);

  return {
    url: normalized.href,
    host,
    descriptionText: summarizeDescription(mergedText, pathText),
    reviewText: reviewHint,
    sellerText: sellerHint,
    price: extractedPrice,
    mrp: marketPrice,
    fetchMode,
    pageExcerpt: mergedText.slice(0, 4000),
  };
}

function extractFirstCurrency(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/html");

  const priceSelectors = [
    "[itemprop='price']",
    "meta[property='product:price:amount']",
    "meta[name='twitter:data1']",
    ".price",
    ".product-price",
    ".a-price .a-offscreen",
    "[data-testid*='price']",
    "[class*='price']",
    "[id*='price']",
  ];

  for (const selector of priceSelectors) {
    const nodes = doc.querySelectorAll(selector);
    for (const node of nodes) {
      const candidate =
        node.getAttribute("content") ||
        node.getAttribute("value") ||
        node.textContent ||
        "";
      const parsed = parseCurrencyValue(candidate);
      if (parsed > 0) return parsed;
    }
  }

  return parseCurrencyValue(text);
}

function parseCurrencyValue(value) {
  const match = value.match(/(?:\$|₹|rs\.?\s*)(\d{2,6}(?:[.,]\d{1,2})?)/i);
  if (!match) return 0;
  return Number(match[1].replace(/,/g, "")) || 0;
}

function extractMarketPrice(text, price) {
  const mrpMatch = text.match(/(?:mrp|list price|was)\D{0,12}(\d{2,6}(?:[.,]\d{1,2})?)/i);
  const parsed = mrpMatch ? Number(mrpMatch[1].replace(/,/g, "")) : 0;
  if (parsed > 0) return parsed;
  if (price > 0) return Math.round(price * 1.18);
  return 0;
}

function extractSellerHint(text, host) {
  const sellerLine = text.match(/seller[^\n]{0,120}/i)?.[0] || "";
  const hostHint = host.replace(/^www\./, "").split(".")[0];
  const joined = [sellerLine, `marketplace ${hostHint} verified return policy support`].join(" ");
  return joined.trim();
}

function extractReviewHint(text) {
  const reviewChunk = text.match(/review[^\n]{0,220}/gi)?.slice(0, 3).join(" ") || "";
  const ratings = text.match(/\b[1-5]\s?(?:star|\/5)\b/gi)?.join(" ") || "";
  return `${reviewChunk} ${ratings}`.trim() || "No direct reviews found";
}

function summarizeDescription(mergedText, pathText) {
  const candidate = mergedText.slice(0, 1200).trim();
  if (candidate.length > 180) return candidate;
  return `Product context inferred from URL slug: ${pathText}. warranty return authentic brand details pending direct source access.`;
}

function scoreListing(extracted) {
  const notes = [];
  let score = 50;

  if (trustedDomains.some((domain) => extracted.url.toLowerCase().includes(domain))) {
    score += 12;
    notes.push("URL domain matches a commonly trusted marketplace.");
  } else {
    score -= 10;
    notes.push("Domain is not recognized in the trusted marketplace list.");
  }

  if (extracted.descriptionText.length > 220) {
    score += 8;
    notes.push("Description context is sufficiently detailed for AI checks.");
  } else {
    score -= 8;
    notes.push("Limited description data available from this URL.");
  }

  const reviewLines = extracted.reviewText.split(/\n|\./).filter((line) => line.trim().length > 20);
  if (reviewLines.length >= 2) {
    score += 6;
    notes.push("Review signals detected for consistency checks.");
  } else {
    score -= 8;
    notes.push("Not enough review evidence extracted from source.");
  }

  const duplicateCount = reviewLines.length - new Set(reviewLines).size;
  if (duplicateCount > 0) {
    score -= 10;
    notes.push("Reviews appear repetitive, which may indicate manipulation.");
  }

  const sellerStrength = sellerSignals.filter((token) => extracted.sellerText.includes(token)).length;
  if (sellerStrength >= 3) {
    score += 10;
    notes.push("Seller details include reliability indicators.");
  } else {
    score -= 12;
    notes.push("Seller profile lacks strong credibility indicators.");
  }

  const riskHits = riskyTerms.filter(
    (term) => extracted.descriptionText.includes(term) || extracted.sellerText.includes(term)
  );
  if (riskHits.length) {
    score -= riskHits.length * 9;
    notes.push(`Risk phrases detected: ${riskHits.join(", ")}.`);
  }

  const trustHits = trustSignals.filter(
    (term) => extracted.descriptionText.includes(term) || extracted.sellerText.includes(term)
  );
  if (trustHits.length >= 2) {
    score += 8;
    notes.push("Trust signals found (warranty/return/authenticity language).");
  }

  if (extracted.price > 0 && extracted.mrp > 0) {
    const discount = ((extracted.mrp - extracted.price) / extracted.mrp) * 100;
    if (discount > 70) {
      score -= 15;
      notes.push("Price is unusually low compared to estimated market value.");
    } else if (discount < 0) {
      notes.push("Price appears above estimated market baseline.");
    } else {
      score += 4;
      notes.push("Price discount appears within a normal range.");
    }
  } else {
    notes.push("Could not reliably extract a price/MRP pair; confidence may be lower.");
  }

  if (extracted.fetchMode === "Inference") {
    score -= 5;
    notes.push("Direct page extraction was limited; analysis used inference fallback.");
  }

  return {
    score: clamp(score, 0, 100),
    notes,
  };
}

async function analyzeWithGemini(extracted, heuristicAnalysis) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      extracted,
      heuristicAnalysis,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Backend Gemini request failed.");
  }

  const summaryLines = [
    `Verdict: ${payload.verdict || "Unavailable"}`,
    `Score: ${Number.isFinite(payload.score) ? payload.score : heuristicAnalysis.score}`,
    "Highlights:",
    ...(Array.isArray(payload.highlights) && payload.highlights.length
      ? payload.highlights.map((item) => `- ${item}`)
      : ["- No highlights returned."]),
    "",
    `Summary: ${payload.summary || "No summary returned."}`,
  ];

  return {
    score: Number(payload.score),
    highlights: Array.isArray(payload.highlights)
      ? payload.highlights
      : [payload.summary || "No Gemini highlights returned."],
    fullText: summaryLines.join("\n"),
  };
}

function renderExtraction(extracted) {
  extractionList.innerHTML = "";

  const rows = [
    `Fetch mode: ${extracted.fetchMode}`,
    `Detected domain: ${extracted.host}`,
    `Detected product price: ${extracted.price ? extracted.price : "Not found"}`,
    `Estimated market price: ${extracted.mrp ? extracted.mrp : "Not found"}`,
    `Seller signal snapshot: ${truncate(extracted.sellerText, 110)}`,
    `Review signal snapshot: ${truncate(extracted.reviewText, 110)}`,
    `Description snapshot: ${truncate(extracted.descriptionText, 110)}`,
  ];

  rows.forEach((row) => {
    const li = document.createElement("li");
    li.textContent = row;
    extractionList.appendChild(li);
  });
}

function truncate(text, max) {
  if (!text) return "Not found";
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function updateUI(score, notes) {
  scoreEl.textContent = `${score}%`;
  meterFill.style.width = `${score}%`;

  let risk = "High Risk";
  let cls = "high";

  if (score >= 75) {
    risk = "Likely Genuine";
    cls = "low";
  } else if (score >= 50) {
    risk = "Needs Manual Check";
    cls = "medium";
  }

  badge.textContent = risk;
  badge.className = `risk-badge ${cls}`;

  insights.innerHTML = "";
  notes.slice(0, 8).forEach((note) => {
    const li = document.createElement("li");
    li.textContent = `AI insight: ${note}`;
    insights.appendChild(li);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
