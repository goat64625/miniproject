const form = document.getElementById("checker-form");
const scoreEl = document.getElementById("score");
const meterFill = document.getElementById("meter-fill");
const badge = document.getElementById("risk-badge");
const insights = document.getElementById("insights");

const trustedDomains = [
  "amazon.",
  "flipkart.",
  "walmart.",
  "bestbuy.",
  "target.",
  "ebay.",
  "etsy.",
];

const riskyTerms = ["no warranty", "copy", "replica", "urgent", "cash only", "wire transfer"];
const trustSignals = ["warranty", "invoice", "return", "authentic", "certified", "brand"];

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const data = new FormData(form);
  const url = (data.get("url") || "").toString().trim().toLowerCase();
  const description = (data.get("description") || "").toString().trim().toLowerCase();
  const reviews = (data.get("reviews") || "").toString().trim().toLowerCase();
  const seller = (data.get("seller") || "").toString().trim().toLowerCase();
  const price = Number(data.get("price") || 0);
  const mrp = Number(data.get("mrp") || 0);

  let score = 50;
  const notes = [];

  if (trustedDomains.some((domain) => url.includes(domain))) {
    score += 12;
    notes.push("URL domain matches a commonly trusted marketplace.");
  } else {
    score -= 10;
    notes.push("Domain is not recognized in the trusted marketplace list.");
  }

  if (description.length > 220) {
    score += 8;
    notes.push("Detailed description suggests listing quality and transparency.");
  } else {
    score -= 8;
    notes.push("Very short description can be a red flag for fake listings.");
  }

  const reviewLines = reviews.split(/\n|\./).filter((line) => line.trim().length > 20);
  if (reviewLines.length >= 3) {
    score += 6;
    notes.push("Enough review content present for consistency checks.");
  } else {
    score -= 8;
    notes.push("Too few meaningful review snippets were provided.");
  }

  const duplicateCount = reviewLines.length - new Set(reviewLines).size;
  if (duplicateCount > 0) {
    score -= 10;
    notes.push("Reviews appear repetitive, which may indicate manipulation.");
  }

  const sellerSignals = ["rating", "years", "return", "verified", "policy", "support"];
  const sellerStrength = sellerSignals.filter((token) => seller.includes(token)).length;
  if (sellerStrength >= 3) {
    score += 10;
    notes.push("Seller details include reliability indicators (rating/policy/support).");
  } else {
    score -= 12;
    notes.push("Seller profile lacks credibility details like policy, history, or rating.");
  }

  const riskHits = riskyTerms.filter((term) => description.includes(term) || seller.includes(term));
  if (riskHits.length) {
    score -= riskHits.length * 9;
    notes.push(`Risk phrases detected: ${riskHits.join(", ")}.`);
  }

  const trustHits = trustSignals.filter(
    (term) => description.includes(term) || seller.includes(term)
  );
  if (trustHits.length >= 2) {
    score += 8;
    notes.push("Trust signals found (warranty/return/authenticity language).");
  }

  if (price > 0 && mrp > 0) {
    const discount = ((mrp - price) / mrp) * 100;
    if (discount > 70) {
      score -= 15;
      notes.push("Price is unusually low compared to market value.");
    } else if (discount < 0) {
      notes.push("Price is above market baseline; verify pricing source.");
    } else {
      score += 4;
      notes.push("Price discount appears within a normal range.");
    }
  }

  score = Math.max(0, Math.min(100, score));
  updateUI(score, notes);
});

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
  notes.slice(0, 6).forEach((note) => {
    const li = document.createElement("li");
    li.textContent = `AI insight: ${note}`;
    insights.appendChild(li);
  });
}
