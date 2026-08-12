/**
 * Provider registry: base URLs, auth headers, and cheap probe endpoints.
 */

const PROVIDERS = {
  openai: {
    label: "OpenAI",
    base_url: "https://api.openai.com",
    auth: "bearer",
    probe: "/v1/models",
  },
  anthropic: {
    label: "Anthropic",
    base_url: "https://api.anthropic.com",
    auth: "x-api-key",
    probe: "/v1/models",
    extra_headers: { "anthropic-version": "2023-06-01" },
  },
  openrouter: {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api",
    auth: "bearer",
    probe: "/v1/models",
  },
  groq: {
    label: "Groq",
    base_url: "https://api.groq.com/openai",
    auth: "bearer",
    probe: "/v1/models",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    base_url: "",
    auth: "bearer",
    probe: "/v1/models",
  },
};

function providerConfig(provider) {
  return PROVIDERS[provider] || PROVIDERS.custom;
}

function resolveBaseUrl(provider, override) {
  const base = (override || "").trim() || providerConfig(provider).base_url;
  return base.replace(/\/+$/, "");
}

function authHeaders(provider, secret) {
  const cfg = providerConfig(provider);
  const headers = { ...(cfg.extra_headers || {}) };
  if (cfg.auth === "x-api-key") {
    headers["x-api-key"] = secret;
  } else {
    headers["authorization"] = `Bearer ${secret}`;
  }
  return headers;
}

function probePath(provider) {
  return providerConfig(provider).probe;
}

module.exports = { PROVIDERS, providerConfig, resolveBaseUrl, authHeaders, probePath };
