
const PRICES = {
  "gpt-4o": [0.0025, 0.01],
  "gpt-4o-mini": [0.00015, 0.0006],
  "gpt-4.1": [0.002, 0.008],
  "gpt-4.1-mini": [0.0004, 0.0016],
  "gpt-4-turbo": [0.01, 0.03],
  "gpt-3.5-turbo": [0.0005, 0.0015],
  "o3-mini": [0.0011, 0.0044],
  "claude-3-5-sonnet": [0.003, 0.015],
  "claude-3-5-haiku": [0.0008, 0.004],
  "claude-3-opus": [0.015, 0.075],
  "claude-sonnet-4": [0.003, 0.015],
  "text-embedding-3-small": [0.00002, 0.0],
  "text-embedding-3-large": [0.00013, 0.0],
};

// Charged when the model is unknown and tokens are reported
const FALLBACK = [0.001, 0.003];
// Charged when we cannot parse usage at all but the call succeeded
const FLAT_UNKNOWN_CALL = 0.002;

function lookup(model) {
  if (!model) return FALLBACK;
  const name = model.toLowerCase();
  if (PRICES[name]) return PRICES[name];
  // match the longest known prefix, e.g. "gpt-4o-2024-08-06" -> "gpt-4o"
  let best = null;
  let bestLen = 0;
  for (const [known, price] of Object.entries(PRICES)) {
    if (name.startsWith(known) && known.length > bestLen) {
      best = price;
      bestLen = known.length;
    }
  }
  return best || FALLBACK;
}

/**
 * Extract [model, promptTokens, completionTokens] from an OpenAI/Anthropic
 * response body (JSON or SSE). Accepts a Buffer or string.
 */
function parseUsage(body) {
  if (!body || body.length === 0) return ["", 0, 0];
  const text = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  const trimmed = text.trim();

  // SSE stream: the usage block rides on one of the last "data:" frames
  if (trimmed.startsWith("data:") || text.includes("\ndata:")) {
    let model = "";
    let pt = 0;
    let ct = 0;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line.startsWith("data:")) continue;
      const chunk = line.slice(5).trim();
      if (!chunk || chunk === "[DONE]") continue;
      let obj;
      try {
        obj = JSON.parse(chunk);
      } catch (err) {
        continue;
      }
      model = obj.model || model;
      const usage = obj.usage || (obj.message && obj.message.usage) || {};
      pt = usage.prompt_tokens || usage.input_tokens || pt;
      ct = usage.completion_tokens || usage.output_tokens || ct;
    }
    return [model || "", parseInt(pt || 0, 10), parseInt(ct || 0, 10)];
  }

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch (err) {
    return ["", 0, 0];
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return ["", 0, 0];

  const usage = obj.usage || {};
  return [
    String(obj.model || ""),
    parseInt(usage.prompt_tokens || usage.input_tokens || 0, 10),
    parseInt(usage.completion_tokens || usage.output_tokens || 0, 10),
  ];
}

function estimateCost(model, promptTokens, completionTokens, statusCode) {
  if (statusCode >= 400) return 0.0;
  if (!promptTokens && !completionTokens) return FLAT_UNKNOWN_CALL;
  const [pIn, pOut] = lookup(model);
  const cost = (promptTokens / 1000.0) * pIn + (completionTokens / 1000.0) * pOut;
  return Math.round(cost * 1e6) / 1e6;
}

module.exports = { PRICES, FALLBACK, FLAT_UNKNOWN_CALL, lookup, parseUsage, estimateCost };
