require("dotenv").config();

function truthy(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}


function normalizeDatabaseUrl(rawUrl) {
  let url = rawUrl;
  if (url.startsWith("postgres://")) {
    url = "postgresql://" + url.slice("postgres://".length);
  }
  for (const bad of [
    "?sslmode=require",
    "&sslmode=require",
    "?channel_binding=require",
    "&channel_binding=require",
  ]) {
    url = url.split(bad).join("");
  }
  return url;
}

const rawDatabaseUrl =
  process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/keyshort";

const settings = {
  databaseUrl: rawDatabaseUrl,
  normalizedDatabaseUrl: normalizeDatabaseUrl(rawDatabaseUrl),
  isNeon: rawDatabaseUrl.includes("neon.tech"),

  redisUrl: process.env.REDIS_URL || "redis://localhost:6379/0",

  // 32+ random chars, signs the session cookie
  secretKey: process.env.SECRET_KEY || "change-me-please-change-me-please",
  // base64-encoded 32 bytes, encrypts stored provider keys
  encryptionKey: process.env.ENCRYPTION_KEY || "",

  // Public base URL of this service, used to build curl snippets
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "http://localhost:8000",

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",

  sessionCookie: process.env.SESSION_COOKIE || "keyshort_session",
  // 24h — was 14 days; tighter for a service holding decrypted keys
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(60 * 60 * 24), 10),

  // When true, the proxy hot path returns X-Vault-*-Ms timing headers.
  // Off by default: these are internal diagnostics, not something to leak
  // to every caller. Flip on in the host's env vars only while benchmarking.
  debugTiming: truthy(process.env.DEBUG_TIMING, false),

  port: parseInt(process.env.PORT || "8000", 10),
};

module.exports = { settings };
