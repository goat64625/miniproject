const form = document.getElementById("checker-form");
const analyzeBtn = document.getElementById("analyze-btn");
const loadingPanel = document.getElementById("loading-panel");
const loadingText = document.getElementById("loading-text");
const subtitle = document.getElementById("result-subtitle");
const cacheBadge = document.getElementById("cache-badge");
const productName = document.getElementById("product-name");
const productImage = document.getElementById("product-image");
const imagePlaceholder = document.getElementById("image-placeholder");
const productMedia = document.getElementById("product-media");
const priceValue = document.getElementById("price-value");
const originalPriceValue = document.getElementById("original-price-value");
const discountValue = document.getElementById("discount-value");
const availabilityValue = document.getElementById("availability-value");
const brandValue = document.getElementById("brand-value");
const merchantValue = document.getElementById("merchant-value");
const scoreEl = document.getElementById("score");
const meterFill = document.getElementById("meter-fill");
const riskBadge = document.getElementById("risk-badge");
const summaryText = document.getElementById("summary-text");
const insights = document.getElementById("insights");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const url = `${formData.get("url") || ""}`.trim();

  setLoading(true, "Fetching the product page and preparing Gemini analysis.");
  subtitle.textContent = "Waiting for server-side AI analysis…";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Analysis failed.");
    }

    renderResult(payload);
  } catch (error) {
    renderError(error.message || "Unable to analyze this URL.");
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading, message = "") {
  analyzeBtn.disabled = isLoading;
  analyzeBtn.textContent = isLoading ? "Analyzing…" : "Analyze URL";
  loadingPanel.classList.toggle("hidden", !isLoading);
  loadingText.textContent = message;
}

function renderResult(result) {
  productName.textContent = result.productName || "Product details unavailable";
  subtitle.textContent = result.cached
    ? "Loaded instantly from the server cache for this URL."
    : `Analyzed via ${result.model} using ${result.sourceMode.toLowerCase()}.`;

  cacheBadge.textContent = result.cached ? "Cached Result" : "Fresh Analysis";
  cacheBadge.className = `risk-badge ${result.cached ? "low" : "medium"}`;

  priceValue.textContent = formatMoney(result.price, result.currency);
  originalPriceValue.textContent = formatMoney(result.originalPrice, result.currency);
  discountValue.textContent = Number.isFinite(result.discountPercent) ? `${result.discountPercent}% off` : "--";
  availabilityValue.textContent = result.availability || "Unknown";
  brandValue.textContent = result.brand || "Unknown";
  merchantValue.textContent = result.merchant || "Unknown";
  summaryText.textContent = result.summary || "No summary returned.";

  if (result.image) {
    productImage.src = result.image;
    productImage.alt = result.productName || "Detected product image";
    productImage.hidden = false;
    imagePlaceholder.hidden = true;
    productMedia.classList.remove("empty");
  } else {
    productImage.removeAttribute("src");
    productImage.hidden = true;
    imagePlaceholder.hidden = false;
    productMedia.classList.add("empty");
  }

  const score = clamp(Number(result.confidence) || 0, 0, 100);
  scoreEl.textContent = `${score}%`;
  meterFill.style.width = `${score}%`;

  let label = result.verdict || "Awaiting Analysis";
  let cls = "medium";
  if (score >= 80) cls = "low";
  else if (score < 50) cls = "high";

  riskBadge.textContent = label;
  riskBadge.className = `risk-badge ${cls}`;

  insights.innerHTML = "";
  const items = [
    ...(Array.isArray(result.highlights) ? result.highlights : []),
    `Source URL: ${result.sourceUrl}`,
    `Fetched at: ${new Date(result.fetchedAt).toLocaleString()}`,
  ];

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    insights.appendChild(li);
  });
}

function renderError(message) {
  subtitle.textContent = message;
  cacheBadge.textContent = "Error";
  cacheBadge.className = "risk-badge high";
  summaryText.textContent = "The server could not finish AI analysis for this URL.";
  insights.innerHTML = `<li>${message}</li>`;
  riskBadge.textContent = "Analysis Failed";
  riskBadge.className = "risk-badge high";
  scoreEl.textContent = "--";
  meterFill.style.width = "0%";
}

function formatMoney(value, currency) {
  if (!Number.isFinite(value)) return "--";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency || ""} ${value}`.trim();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
