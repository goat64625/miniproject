const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = "gemini-3-flash-preview";
const ROOT_DIR = __dirname;

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
  const extracted = body?.extracted;
  const heuristicAnalysis = body?.heuristicAnalysis;

  if (!extracted?.url || !heuristicAnalysis) {
    sendJson(res, 400, { error: "Missing extracted data or heuristic analysis." });
    return;
  }

  const prompt = [
    "You are evaluating whether an ecommerce listing looks trustworthy or potentially fraudulent.",
    "Use only the provided webpage-derived signals.",
    "Return strict JSON with keys: score (0-100 number), verdict (string), highlights (array of short strings), summary (string).",
    `URL: ${extracted.url}`,
    `Host: ${extracted.host}`,
    `Fetch Mode: ${extracted.fetchMode}`,
    `Detected Price: ${extracted.price || "unknown"}`,
    `Estimated Market Price: ${extracted.mrp || "unknown"}`,
    `Seller Signals: ${extracted.sellerText}`,
    `Review Signals: ${extracted.reviewText}`,
    `Description Summary: ${extracted.descriptionText}`,
    `Heuristic Score: ${heuristicAnalysis.score}`,
    `Heuristic Notes: ${(heuristicAnalysis.notes || []).join(" | ")}`,
    `Page Excerpt: ${extracted.pageExcerpt || ""}`,
  ].join("\n");

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
        },
      }),
    }
  );

  const payload = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    sendJson(res, geminiResponse.status, {
      error: payload?.error?.message || "Gemini request failed.",
    });
    return;
  }

  const rawText = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("\n")
    .trim();

  if (!rawText) {
    sendJson(res, 502, { error: "Gemini returned an empty response." });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = {
      score: heuristicAnalysis.score,
      verdict: "Manual review recommended",
      highlights: ["Gemini response was not valid JSON; showing raw output."],
      summary: rawText,
    };
  }

  sendJson(res, 200, {
    score: Number(parsed.score),
    verdict: parsed.verdict || "Unavailable",
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights
      : [parsed.summary || "No Gemini highlights returned."],
    summary: parsed.summary || "No summary returned.",
    model: GEMINI_MODEL,
  });
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

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

server.listen(PORT, HOST, () => {
  console.log(`TrustLens AI server listening on http://${HOST}:${PORT}`);
});
